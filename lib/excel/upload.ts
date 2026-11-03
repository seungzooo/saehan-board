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
  duplicateCodes,
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
      /** 같은 파일에 두 줄 이상 나온 품번 수 — 합산하지 않고 확인 필요 */
      duplicateCodes: number;
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
  const dups = duplicateCodes(mapped.rows.map((r) => r.productCode));
  for (const r of mapped.rows) {
    const code = r.productCode;
    if (!code) continue;
    if (dups.has(code)) {
      errors.push({ row: r.__row, message: `중복 품번: ${code} 이(가) 파일에 ${dups.get(code)}줄 — 합산하지 않고 확인 필요로 둡니다`, kind: "DUP", code });
      continue;
    }
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
    duplicateCodes: dups.size,
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

// ───────────────────────── 업로드 상세 · 취소 ─────────────────────────

export type BatchDiffRow = { code: string; name: string; before: number | null; after: number | null };

/** 업로드 배치 상세. 재고면 직전 기준 배치(이 배치보다 앞, 복구 안 된 것)와 품목별 비교 */
export async function getBatchDetail(id: string, db: PrismaClient = prisma) {
  const batch = await db.uploadBatch.findUnique({ where: { id } });
  if (!batch) return null;
  const latestStock = await latestStockBatch(db);
  if (batch.kind === "STOCK") {
    const prev = await db.uploadBatch.findFirst({
      where: { kind: "STOCK", revertedAt: null, uploadedAt: { lt: batch.uploadedAt } },
      orderBy: { uploadedAt: "desc" },
    });
    const [cur, before] = await Promise.all([
      db.stockSnapshot.findMany({ where: { batchId: batch.id }, select: { productCode: true, qtyBox: true, product: { select: { name: true } } } }),
      prev
        ? db.stockSnapshot.findMany({ where: { batchId: prev.id }, select: { productCode: true, qtyBox: true, product: { select: { name: true } } } })
        : Promise.resolve([]),
    ]);
    const b = new Map(before.map((s) => [s.productCode, s]));
    const a = new Map(cur.map((s) => [s.productCode, s]));
    const rows: BatchDiffRow[] = [];
    for (const s of cur) rows.push({ code: s.productCode, name: s.product.name, before: b.get(s.productCode)?.qtyBox ?? null, after: s.qtyBox });
    for (const s of before) if (!a.has(s.productCode)) rows.push({ code: s.productCode, name: s.product.name, before: s.qtyBox, after: null });
    const added = rows.filter((r) => r.before === null).length;
    const missing = rows.filter((r) => r.after === null).length;
    const changed = rows.filter((r) => r.before !== null && r.after !== null && r.before !== r.after).length;
    const same = rows.filter((r) => r.before !== null && r.before === r.after).length;
    // 변경·신규·누락을 위로, 차이 큰 순
    const rank = (r: BatchDiffRow) => (r.before === null || r.after === null ? 1e9 : Math.abs(r.after - r.before));
    rows.sort((x, y) => rank(y) - rank(x) || x.name.localeCompare(y.name, "ko"));
    return {
      batch,
      kind: "STOCK" as const,
      previous: prev,
      rows,
      counts: { added, changed, same, missing, skipped: Math.max(0, batch.rowCount - cur.length) },
      canCancel: !batch.revertedAt && latestStock?.id === batch.id,
      cancelBlockedReason: batch.revertedAt ? "이미 취소된 업로드입니다." : latestStock?.id !== batch.id ? "최신 재고 업로드만 취소할 수 있습니다." : null,
    };
  }
  if (batch.kind === "SALES" || batch.kind === "PRODUCTION") {
    const table = batch.kind === "SALES" ? db.shipmentHistory : db.productionHistory;
    const [count, range] = await Promise.all([
      (table as typeof db.shipmentHistory).count({ where: { batchId: batch.id } }),
      (table as typeof db.shipmentHistory).aggregate({ where: { batchId: batch.id }, _min: { date: true }, _max: { date: true } }),
    ]);
    return {
      batch,
      kind: batch.kind as "SALES" | "PRODUCTION",
      inserted: count,
      skipped: Math.max(0, batch.rowCount - count),
      period: range._min.date && range._max.date ? { from: range._min.date.toISOString().slice(0, 10), to: range._max.date.toISOString().slice(0, 10) } : null,
      canCancel: !batch.revertedAt,
      cancelBlockedReason: batch.revertedAt ? "이미 취소된 업로드입니다." : null,
    };
  }
  return {
    batch,
    kind: batch.kind as "PRODUCT" | "CUSTOMER",
    canCancel: false,
    cancelBlockedReason: "제품·거래처 마스터는 기존 값을 덮어쓰므로 취소할 수 없습니다. 고친 파일을 다시 올리세요.",
  };
}

export type CancelBatchResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * 업로드 취소.
 * - 재고: 최신 배치만 — revertLatestStock (직전 배치가 다시 기준)
 * - 출고·생산실적: 이 배치로 새로 들어간 행만 지우고(중복으로 건너뛴 행은 원래 배치 소속이라 남는다) 월별 집계 재계산
 */
export async function cancelBatch(id: string, db: PrismaClient = prisma): Promise<CancelBatchResult> {
  const batch = await db.uploadBatch.findUnique({ where: { id } });
  if (!batch) return { ok: false, message: "업로드를 찾을 수 없습니다." };
  if (batch.revertedAt) return { ok: false, message: "이미 취소된 업로드입니다." };
  if (batch.kind === "STOCK") {
    const r = await revertLatestStock(id, db);
    if (!r.ok) return r;
    return { ok: true, message: r.nowBasis ? `취소 완료. 현재 기준: ${r.nowBasis.fileName}` : "취소 완료. 현재 기준 재고 파일이 없습니다." };
  }
  if (batch.kind === "SALES" || batch.kind === "PRODUCTION") {
    const deleted = await db.$transaction(
      async (tx) => {
        const t = tx as unknown as PrismaClient;
        const r =
          batch.kind === "SALES"
            ? await t.shipmentHistory.deleteMany({ where: { batchId: id } })
            : await t.productionHistory.deleteMany({ where: { batchId: id } });
        await t.uploadBatch.update({ where: { id }, data: { revertedAt: new Date() } });
        await rebuildMonthlyStat(t);
        return r.count;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return { ok: true, message: `취소 완료. 이 업로드로 추가된 ${deleted.toLocaleString()}행을 지우고 월별 집계를 다시 계산했습니다.` };
  }
  return { ok: false, message: "제품·거래처 마스터는 취소할 수 없습니다." };
}
