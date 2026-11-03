"use server";

import type { UploadKind } from "@/config/excel-mapping";
import {
  cancelBatch,
  type CancelBatchResult,
  previewStock,
  processUpload,
  revertLatestStock,
  type RevertResult,
  type StockPreview,
  type UploadResponse,
} from "@/lib/excel/upload";
import { revalidatePath } from "next/cache";

const KINDS: UploadKind[] = ["STOCK", "PRODUCTION", "SALES", "PRODUCT", "CUSTOMER"];
const MAX_BYTES = 50 * 1024 * 1024;
/** 로그인 없음(F8 삭제). 업로더는 고정값으로 기록 */
const ACTOR = "담당자";

function fileFrom(formData: FormData): File | { error: string } {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "파일을 선택하세요." };
  if (file.size > MAX_BYTES) return { error: "파일이 50MB를 넘습니다." };
  return file;
}

function parseAsOf(formData: FormData): { stockAsOf: Date | null } | { error: string } {
  const raw = formData.get("stockAsOf");
  if (typeof raw !== "string" || !raw.trim()) return { stockAsOf: null };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return { error: "집계 기준 시각 형식이 잘못되었습니다." };
  if (d.getTime() > Date.now() + 5 * 60 * 1000) return { error: "집계 기준 시각이 미래입니다." };
  return { stockAsOf: d };
}

/** 재고 파일 미리보기 — 저장하지 않는다 */
export async function previewStockAction(formData: FormData): Promise<StockPreview> {
  const file = fileFrom(formData);
  if ("error" in file) return { status: "error", message: file.error };
  return previewStock(new Uint8Array(await file.arrayBuffer()));
}

export async function uploadAction(formData: FormData): Promise<UploadResponse> {
  const kind = formData.get("kind");
  if (typeof kind !== "string" || !KINDS.includes(kind as UploadKind)) {
    return { status: "error", message: "업로드 종류가 잘못되었습니다." };
  }
  const file = fileFrom(formData);
  if ("error" in file) return { status: "error", message: file.error };
  const asOf = parseAsOf(formData);
  if ("error" in asOf) return { status: "error", message: asOf.error };

  const defectApplied = formData.get("defectApplied") === "yes";
  const mode = formData.get("mode") === "MERGE" ? "MERGE" : "REPLACE";
  const allowRowErrors = formData.get("allowRowErrors") === "1";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await processUpload(kind as UploadKind, file.name, bytes, ACTOR, {
    stockAsOf: asOf.stockAsOf,
    defectApplied,
    mode,
    allowRowErrors,
  });
  if (res.status === "saved") revalidateAll();
  return res;
}

/** 최신 재고 배치를 복구해 직전 기준재고로 되돌린다 */
export async function revertStockAction(batchId: string): Promise<RevertResult> {
  const r = await revertLatestStock(batchId);
  if (r.ok) revalidateAll();
  return r;
}

/** 업로드 상세의 "이 업로드 취소" */
export async function cancelBatchAction(batchId: string): Promise<CancelBatchResult> {
  const r = await cancelBatch(batchId);
  if (r.ok) {
    revalidateAll();
    revalidatePath(`/upload/${batchId}`);
    revalidatePath("/analytics");
  }
  return r;
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/upload");
  revalidatePath("/stock");
  revalidatePath("/adjust");
}
