"use server";

import type { UploadKind } from "@/config/excel-mapping";
import { processUpload, type UploadResponse } from "@/lib/excel/upload";
import { revalidatePath } from "next/cache";

const KINDS: UploadKind[] = ["STOCK", "PRODUCTION", "SALES", "PRODUCT", "CUSTOMER"];
const MAX_BYTES = 50 * 1024 * 1024;
/** 로그인 없음(F8 삭제). 업로더는 고정값으로 기록 */
const ACTOR = "담당자";

export async function uploadAction(formData: FormData): Promise<UploadResponse> {
  const kind = formData.get("kind");
  const file = formData.get("file");
  if (typeof kind !== "string" || !KINDS.includes(kind as UploadKind)) {
    return { status: "error", message: "업로드 종류가 잘못되었습니다." };
  }
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "파일을 선택하세요." };
  if (file.size > MAX_BYTES) return { status: "error", message: "파일이 50MB를 넘습니다." };

  // 재고 전용 옵션. stockAsOf는 클라이언트가 ISO(+09:00 포함)로 보낸다
  let stockAsOf: Date | null = null;
  const asOfRaw = formData.get("stockAsOf");
  if (typeof asOfRaw === "string" && asOfRaw.trim()) {
    const d = new Date(asOfRaw);
    if (Number.isNaN(d.getTime())) return { status: "error", message: "집계 기준 시각 형식이 잘못되었습니다." };
    if (d.getTime() > Date.now() + 5 * 60 * 1000) return { status: "error", message: "집계 기준 시각이 미래입니다." };
    stockAsOf = d;
  }
  const defectApplied = formData.get("defectApplied") === "yes";
  const allowRowErrors = formData.get("allowRowErrors") === "1";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await processUpload(kind as UploadKind, file.name, bytes, ACTOR, { stockAsOf, defectApplied, allowRowErrors });
  if (res.status === "saved") {
    revalidatePath("/");
    revalidatePath("/upload");
    revalidatePath("/stock");
  }
  return res;
}
