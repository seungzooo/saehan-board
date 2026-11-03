/**
 * F1 업로드 처리 (서버 전용). 파일 bytes → 파싱 → 매핑 검증 → 트랜잭션 저장.
 *
 * - 같은 파일(해시 동일)은 두 번 저장하지 않는다 (복구된 배치는 예외 — 지우고 다시 받는다).
 * - 필수 컬럼이 없으면 아무것도 저장하지 않는다 (트랜잭션 롤백 → 직전 기준 유지).
 * - 행 단위 오류(품번 불일치·수량 누락 등)가 있으면 allowRowErrors=false일 때 저장하지 않고
 *   오류 목록을 돌려준다. 담당자가 확인하면 allowRowErrors=true로 다시 호출한다.
 * - 재고(STOCK): 집계 기준 시각(stockAsOf)·사후 불량 반영 여부(defectApplied)·모드(REPLACE/MERGE)를 배치에 기록.
 *   previewStock()으로 저장 전에 기존 대비 신규/변경/누락을 보여주고, revertLatestStock()으로 직전 기준으로 복구한다.
 */
import { createHash } from "node:crypto";
import { STOCK_MAPPING, type UploadKind } from "@/config/excel-mapping";
import { rebuildMonthlyStat } from "@/lib/analytics/monthlyStat";
import { prisma } from "@/lib/db";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import {
  importCustomers,
  importProduction,
  importProducts,
  importSales,
  importStock,
  type ImportOutcome,
  type ImportResult,
  type RowError,
} from "./import";
import { applyMapping, toNumber } from "./mapping";
import { parseWorkbookBytes } from "./parse";

export type StockMode = "REPLACE" | "MERGE";

export type UploadOptions = {
  /** (STOCK) 파일의 집계 기준 시각. null이면 "집계 시각 미확인" */
  stockAsOf?: Date | null;
  /** (STOCK) 파일에 사후 불량이 반영되어 있음 → 이전 불량 차감 리셋 */
  defectApplied?: boolean;
  /** (STOCK) REPLACE 전체 교체(기본) | MERGE 있는 품목만 갱신, 나머지는 직전 배치에서 이월 */
  mode?: StockMode;
  /** 행 오류가 있어도 그대로 저장 (담당자 확인 후) */
  allowRowErrors?: boolean;
};

export type UploadResponse =
  | { status: "saved"; batchId: string; format: string; result: ImportResult; uploadedAt: string; elapsedMs: number }
  | { status: "duplicate"; batchId: string; uploadedAt: string; fileName: string }
  | { status: "mapping-error"; missing: string[]; headerFound: string[]; format: string }
  | { status: "row-errors"; errors: RowError[]; errorCount: number; validRows: number; format: string }
  | { status: "error"; message: string };

export const UPLOAD_KIND_LABEL: Record<UploadKind, string> = {
  STOCK: "재고",
  PRODUCTION: "생산실적",
  SALES: "출고실적",
  PRODUCT: "제품 마스터",
  CUSTOMER: "거래처",
};

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function processUpload(
  kind: UploadKind,
  fileName: string,
  bytes: Uint8Array,
  uploadedBy: string,
  options: UploadOptions = {},
  db: PrismaClient = prisma,
): Promise<UploadResponse> {
  const t0 = Date.now();
  const fileHash = sha256(bytes);
  const dup = await db.uploadBatch.findUnique({ where: { fileHash } });
  if (dup && !dup.revertedAt) {
    return { status: "duplicate", batchId: dup.id, uploadedAt: dup.uploadedAt.toISOString(), fileName: dup.fileName };
  }

  let parsed;
  try {
    parsed = parseWorkbookBytes(bytes);
  } catch (e) {
    return { status: "error", message: `파일을 읽을 수 없습니다: ${(e as Error).message}` };
  }
  if (parsed.rows.length < 2) return { status: "error", message: "헤더 외에 데이터 행이 없습니다." };

  const uploadedAt = new Date();
  const isStock = kind === "STOCK";
  const stockAsOf = isStock ? (options.stockAsOf ?? null) : null;
  const defectApplied = isStock ? !!options.defectApplied : false;
  const mode: StockMode = isStock && options.mode === "MERGE" ? "MERGE" : "REPLACE";
  try {
    const outcome = await db.$transaction(
      async (tx) => {
        const tdb = tx as unknown as PrismaClient;
        // 복구된 같은 파일이 있으면 지우고 다시 받는다 (fileHash unique)
        if (dup?.revertedAt) {
          await tdb.stockSnapshot.deleteMany({ where: { batchId: dup.id } });
          await tdb.uploadBatch.delete({ where: { id: dup.id } });
        }
        const carryFrom = isStock && mode === "MERGE" ? await latestStockBatch(tdb) : null;
        const batch = await tdb.uploadBatch.create({
          data: { kind, fileName, fileHash, rowCount: parsed.rows.length - 1, uploadedAt, uploadedBy, stockAsOf, defectApplied, mode },
        });
        let r: ImportOutcome;
        switch (kind) {
          case "STOCK":
            r = await importStock(tdb, parsed.rows, {
              batchId: batch.id,
              uploadedBy,
              uploadedAt,
              stockAsOf,
              mode,
              carryFromBatchId: carryFrom?.id ?? null,
            });
            break;
          case "SALES":
            r = await importSales(tdb, parsed.rows, { batchId: batch.id });
            break;
          case "PRODUCTION":
            r = await importProduction(tdb, parsed.rows, { batchId: batch.id });
            break;
          case "PRODUCT":
            r = await importProducts(tdb, parsed.rows);
            break;
          case "CUSTOMER":
            r = await importCustomers(tdb, parsed.rows);
            break;
        }
        if (!r.ok) throw new MappingError(r.missing, r.headerFound);
        if (r.errors.length > 0 && !options.allowRowErrors) throw new RowErrorsAbort(r.errors, r.inserted);
        if (kind === "SALES" || kind === "PRODUCTION" || kind === "CUSTOMER") await rebuildMonthlyStat(tdb);
        return { batchId: batch.id, result: r };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return {
      status: "saved",
      batchId: outcome.batchId,
      format: parsed.format,
      result: outcome.result,
      uploadedAt: uploadedAt.toISOString(),
      elapsedMs: Date.now() - t0,
    };
  } catch (e) {
    if (e instanceof MappingError) {
      return { status: "mapping-error", missing: e.missing, headerFound: e.headerFound, format: parsed.format };
    }
    if (e instanceof RowErrorsAbort) {
      return { status: "row-errors", errors: e.errors, errorCount: e.errors.length, validRows: e.validRows, format: parsed.format };
    }
    return { status: "error", message: (e as Error).message };
  }
}

async function latestStockBatch(db: PrismaClient) {
  return db.uploadBatch.findFirst({ where: { kind: "STOCK", revertedAt: null }, orderBy: { uploadedAt: "desc" } });
}

// ───────────────────────── 재고 미리보기 ─────────────────────────

export type StockPreview =
  | {
      status: "ok";
      format: string;
      /** 파일의 정상 행(품번별 합산) 수 */
      fileProducts: number;
      /** 기존 기준 배치 대비 */
      added: number; // 파일에는 있고 기존 배치에는 없음
      changed: number; // 둘 다 있고 수량 다름
      same: number; // 둘 다 있고 수량 같음
      missing: number; // 기존 배치에는 있고 파일에는 없음 (REPLACE면 확인 필요, MERGE면 이월)
      missingSample: { code: string; name: string; qtyBox: number }[];
      changedSample: { code: string; name: string; before: number; after: number }[];
      errors: RowError[];
      errorCount: number;
      duplicate: { batchId: string; uploadedAt: string; fileName: string } | null;
      previousBatch: { id: string; fileName: string; uploadedAt: string; products: number } | null;
    }
  | { status: "mapping-error"; missing: string[]; headerFound: string[]; format: string }
  | { status: "error"; message: string };

/** 저장하지 않고 파일을 읽어 기존 기준 배치와 비교한다 */
export async function previewStock(bytes: Uint8Array, db: PrismaClient = prisma): Promise<StockPreview> {
  let parsed;
  try {
    parsed = parseWorkbookBytes(bytes);
  } catch (e) {
    return { status: "error", message: `파일을 읽을 수 없습니다: ${(e as Error).message}` };
  }
  if (parsed.rows.length < 2) return { status: "error", message: "헤더 외에 데이터 행이 없습니다." };
  const mapped = applyMapping(parsed.rows, STOCK_MAPPING);
  if (!mapped.ok) return { status: "mapping-error", missing: mapped.missing, headerFound: mapped.headerFound, format: parsed.format };

  const codes = [...new Set(mapped.rows.map((r) => r.productCode).filter(Boolean))];
  const products = new Map(
    (await db.product.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })).map((p) => [p.code, p.name]),
  );
  const qty = new Map<string, number>();
  const errors: RowError[] = [];
  for (const r of mapped.rows) {
    const code = r.productCode;
    if (!code) continue;
    if (!products.has(code)) {
      errors.push({ row: r.__row, message: `품번 불일치: "${code}" 이(가) 제품 마스터에 없음`, kind: "CODE", code });
      continue;
    }
    if (r.qtyBox === "") {
      errors.push({ row: r.__row, message: `수량 누락: ${code}`, kind: "QTY", code });
      continue;
    }
    const n = toNumber(r.qtyBox);
    if (Number.isNaN(n)) {
      errors.push({ row: r.__row, message: `수량 오류: ${code} 재고수량이 숫자가 아님 "${r.qtyBox}"`, kind: "QTY", code });
      continue;
    }
    qty.set(code, (qty.get(code) ?? 0) + n);
  }

  const prev = await latestStockBatch(db);
  const prevSnaps = prev
    ? await db.stockSnapshot.findMany({
        where: { batchId: prev.id },
        select: { productCode: true, qtyBox: true, product: { select: { name: true } } },
      })
    : [];
  const prevMap = new Map(prevSnaps.map((s) => [s.productCode, { qtyBox: s.qtyBox, name: s.product.name }]));

  let added = 0;
  let changed = 0;
  let same = 0;
  const changedSample: { code: string; name: string; before: number; after: number }[] = [];
  for (const [code, q] of qty) {
    const p = prevMap.get(code);
    const after = Math.round(q);
    if (!p) added++;
    else if (p.qtyBox !== after) {
      changed++;
      if (changedSample.length < 10) changedSample.push({ code, name: p.name, before: p.qtyBox, after });
    } else same++;
  }
  const missingList = [...prevMap.entries()].filter(([code]) => !qty.has(code));
  const dup = await db.uploadBatch.findUnique({ where: { fileHash: sha256(bytes) } });

  return {
    status: "ok",
    format: parsed.format,
    fileProducts: qty.size,
    added,
    changed,
    same,
    missing: missingList.length,
    missingSample: missingList.slice(0, 10).map(([code, p]) => ({ code, name: p.name, qtyBox: p.qtyBox })),
    changedSample,
    errors,
    errorCount: errors.length,
    duplicate: dup && !dup.revertedAt ? { batchId: dup.id, uploadedAt: dup.uploadedAt.toISOString(), fileName: dup.fileName } : null,
    previousBatch: prev
      ? { id: prev.id, fileName: prev.fileName, uploadedAt: prev.uploadedAt.toISOString(), products: prevSnaps.length }
      : null,
  };
}

// ───────────────────────── 복구 ─────────────────────────

export type RevertResult =
  | { ok: true; reverted: { id: string; fileName: string; uploadedAt: string }; nowBasis: { fileName: string; uploadedAt: string } | null }
  | { ok: false; message: string };

/** 최신 재고 배치를 복구(revertedAt 기록). 그 직전 배치가 다시 기준이 된다 */
export async function revertLatestStock(expectedBatchId: string, db: PrismaClient = prisma): Promise<RevertResult> {
  const latest = await latestStockBatch(db);
  if (!latest) return { ok: false, message: "복구할 재고 배치가 없습니다." };
  if (latest.id !== expectedBatchId) return { ok: false, message: "그 사이 다른 업로드가 있었습니다. 화면을 새로고침하세요." };
  await db.uploadBatch.update({ where: { id: latest.id }, data: { revertedAt: new Date() } });
  const now = await latestStockBatch(db);
  return {
    ok: true,
    reverted: { id: latest.id, fileName: latest.fileName, uploadedAt: latest.uploadedAt.toISOString() },
    nowBasis: now ? { fileName: now.fileName, uploadedAt: now.uploadedAt.toISOString() } : null,
  };
}

class MappingError extends Error {
  constructor(
    public missing: string[],
    public headerFound: string[],
  ) {
    super("mapping error");
  }
}

class RowErrorsAbort extends Error {
  constructor(
    public errors: RowError[],
    public validRows: number,
  ) {
    super("row errors");
  }
}
