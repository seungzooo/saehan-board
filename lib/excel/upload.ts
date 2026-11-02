/**
 * F1 업로드 처리 (서버 전용). 파일 bytes → 파싱 → 매핑 검증 → 트랜잭션 저장.
 * 같은 파일(해시 동일)은 두 번 저장하지 않는다.
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
} from "./import";
import { parseWorkbookBytes } from "./parse";

export type UploadResponse =
  | { status: "saved"; batchId: string; format: string; result: ImportResult; uploadedAt: string; elapsedMs: number }
  | { status: "duplicate"; batchId: string; uploadedAt: string; fileName: string }
  | { status: "mapping-error"; missing: string[]; headerFound: string[]; format: string }
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
): Promise<UploadResponse> {
  const t0 = Date.now();
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const dup = await prisma.uploadBatch.findUnique({ where: { fileHash } });
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
  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const batch = await tx.uploadBatch.create({
          data: { kind, fileName, fileHash, rowCount: parsed.rows.length - 1, uploadedAt, uploadedBy },
        });
        const db = tx as unknown as PrismaClient;
        let r: ImportOutcome;
        switch (kind) {
          case "STOCK":
            r = await importStock(db, parsed.rows, { batchId: batch.id, uploadedBy, uploadedAt });
            break;
          case "SALES":
            r = await importSales(db, parsed.rows, { batchId: batch.id });
            break;
          case "PRODUCTION":
            r = await importProduction(db, parsed.rows, { batchId: batch.id });
            break;
          case "PRODUCT":
            r = await importProducts(db, parsed.rows);
            break;
          case "CUSTOMER":
            r = await importCustomers(db, parsed.rows);
            break;
        }
        if (!r.ok) throw new MappingError(r.missing, r.headerFound);
        if (kind === "SALES" || kind === "PRODUCTION" || kind === "CUSTOMER") await rebuildMonthlyStat(db);
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
