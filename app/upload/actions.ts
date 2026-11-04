"use server";

import { prisma } from "@/lib/db";
import { rebuildShipmentEvents } from "@/lib/events/rebuild";

import type { UploadKind } from "@/config/excel-mapping";
import { DATA_TAG } from "@/lib/analytics/cached";
import {
  cancelBatch,
  suggestCompletion,
  updateCompletion,
  type CancelBatchResult,
  previewStock,
  processUpload,
  revertLatestStock,
  type RevertResult,
  type StockPreview,
  type UploadResponse,
} from "@/lib/excel/upload";
import { requirePin } from "@/lib/pin";
import { revalidatePath, updateTag } from "next/cache";

const KINDS: UploadKind[] = ["STOCK", "PRODUCTION", "SALES", "PRODUCT", "CUSTOMER", "INDUSTRY"];
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
  const denied = await requirePin();
  if (denied) return { status: "error", message: denied };
  const file = fileFrom(formData);
  if ("error" in file) return { status: "error", message: file.error };
  return previewStock(new Uint8Array(await file.arrayBuffer()));
}

export async function uploadAction(formData: FormData): Promise<UploadResponse> {
  const denied = await requirePin();
  if (denied) return { status: "error", message: denied };
  const kind = formData.get("kind");
  if (typeof kind !== "string" || !KINDS.includes(kind as UploadKind)) {
    return { status: "error", message: "업로드 종류가 잘못되었습니다." };
  }
  const file = fileFrom(formData);
  if ("error" in file) return { status: "error", message: file.error };
  const asOf = parseAsOf(formData);
  if ("error" in asOf) return { status: "error", message: asOf.error };

  // 재고: 집계 기준 시각과 사후 불량 반영 여부는 담당자가 직접 정한다 (파일만으로 반영 범위를 알 수 없으므로 추정하지 않음)
  if (kind === "STOCK" && !asOf.stockAsOf) return { status: "error", message: "이 파일의 집계 기준 시각(ERP에서 재고를 조회한 시각)을 입력하세요." };
  const defectRaw = formData.get("defectApplied");
  if (kind === "STOCK" && defectRaw !== "yes" && defectRaw !== "no") return { status: "error", message: "이 파일에 사후 불량이 반영되어 있는지 선택하세요." };
  const defectApplied = defectRaw === "yes";
  const mode = formData.get("mode") === "MERGE" ? "MERGE" : "REPLACE";
  const allowRowErrors = formData.get("allowRowErrors") === "1";
  const ct = formData.get("completeThrough");
  const completeThrough = typeof ct === "string" && ct.trim() ? ct.trim() : null;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await processUpload(kind as UploadKind, file.name, bytes, ACTOR, {
    stockAsOf: asOf.stockAsOf,
    defectApplied,
    mode,
    allowRowErrors,
    completeThrough,
  });
  if (res.status === "saved") {
    // 재고 파일은 실적 집계에 영향이 없다. 그 밖의 업로드는 실적 기반 캐시를 무효화
    if (kind !== "STOCK") updateTag(DATA_TAG);
    // 출고실적이 바뀌면 변동 탐지 결과를 다시 계산해 저장 (화면은 저장된 결과만 읽는다)
    if (kind === "SALES") await refreshEvents();
    revalidateAll();
  }
  return res;
}

/** 최신 재고 배치를 복구해 직전 기준재고로 되돌린다 */
export async function revertStockAction(batchId: string): Promise<RevertResult> {
  const denied = await requirePin();
  if (denied) return { ok: false, message: denied };
  const r = await revertLatestStock(batchId);
  if (r.ok) revalidateAll();
  return r;
}

/** 업로드 상세의 "이 업로드 취소" */
export async function cancelBatchAction(batchId: string): Promise<CancelBatchResult> {
  const denied = await requirePin();
  if (denied) return { ok: false, message: denied };
  const r = await cancelBatch(batchId);
  if (r.ok) {
    updateTag(DATA_TAG);
    await refreshEvents();
    revalidateAll();
    revalidatePath(`/upload/${batchId}`);
    revalidatePath("/analytics");
  }
  return r;
}

/** 출고·생산실적 파일을 고르면 집계 완료 월 기본값을 제안 (저장하지 않음) */
export async function suggestCompletionAction(formData: FormData) {
  const denied = await requirePin();
  if (denied) return { ok: false as const, message: denied };
  const kind = formData.get("kind");
  if (kind !== "SALES" && kind !== "PRODUCTION") return { ok: false as const, message: "출고실적·생산실적만 해당합니다." };
  const file = fileFrom(formData);
  if ("error" in file) return { ok: false as const, message: file.error };
  return suggestCompletion(kind, new Uint8Array(await file.arrayBuffer()));
}

/** 업로드 상세에서 집계 완료 월 수정 (PIN 보호) */
export async function updateCompletionAction(batchId: string, value: string) {
  const denied = await requirePin();
  if (denied) return { ok: false as const, message: denied };
  const r = await updateCompletion(batchId, value);
  if (r.ok) {
    updateTag(DATA_TAG);
    await refreshEvents();
    revalidatePath(`/upload/${batchId}`);
    revalidatePath("/upload");
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

/** 변동 탐지 다시 계산. 실패해도 업로드 결과는 유지(다음 업로드나 scripts/rebuild-events.ts로 다시) */
async function refreshEvents() {
  try {
    await rebuildShipmentEvents(prisma);
  } catch (e) {
    console.error("변동 탐지 다시 계산 실패", e);
  }
}
