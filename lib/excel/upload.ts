/**
 * F1 업로드 처리 (서버 전용). 파일 bytes → 파싱 → 매핑 검증 → 트랜잭션 저장.
 *
 * - 같은 파일(해시 동일)은 두 번 저장하지 않는다.
 * - 필수 컬럼이 없으면 아무것도 저장하지 않는다 (트랜잭션 롤백 → 직전 기준 유지).
 * - 행 단위 오류(수량이 숫자가 아님 등)가 있으면 allowRowErrors=false일 때 저장하지 않고
 *   오류 목록을 돌려준다. 담당자가 확인하면 allowRowErrors=true로 다시 호출한다.
 * - 재고(STOCK)는 집계 기준 시각(stockAsOf)과 사후 불량 반영 여부(defectApplied)를 배치에 기록한다.
 */
import { createHash } from "node:crypto";
import type { UploadKind } from "@/config/excel-mapping";
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
import { parseWorkbookBytes } from "./parse";

export type UploadOptions = {
  /** (STOCK) 파일의 집계 기준 시각. null이면 "집계 시각 미확인" */
  stockAsOf?: Date | null;
  /** (STOCK) 파일에 사후 불량이 반영되어 있음 → 이전 불량 차감 리셋 */
  defectApplied?: boolean;
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

export async function processUpload(
  kind: UploadKind,
  fileName: string,
  bytes: Uint8Array,
  uploadedBy: string,
  options: UploadOptions = {},
  db: PrismaClient = prisma,
): Promise<UploadResponse> {
  const t0 = Date.now();
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const dup = await db.uploadBatch.findUnique({ where: { fileHash } });
  if (dup) {
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
  const stockAsOf = kind === "STOCK" ? (options.stockAsOf ?? null) : null;
  const defectApplied = kind === "STOCK" ? !!options.defectApplied : false;
  try {
    const outcome = await db.$transaction(
      async (tx) => {
        const batch = await tx.uploadBatch.create({
          data: { kind, fileName, fileHash, rowCount: parsed.rows.length - 1, uploadedAt, uploadedBy, stockAsOf, defectApplied },
        });
        const tdb = tx as unknown as PrismaClient;
        let r: ImportOutcome;
        switch (kind) {
          case "STOCK":
            r = await importStock(tdb, parsed.rows, { batchId: batch.id, uploadedBy, uploadedAt, stockAsOf });
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
