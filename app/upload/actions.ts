"use server";

import type { UploadKind } from "@/config/excel-mapping";
import { canUpload, getCurrentUser } from "@/lib/auth";
import { processUpload, type UploadResponse } from "@/lib/excel/upload";
import { revalidatePath } from "next/cache";

const KINDS: UploadKind[] = ["STOCK", "PRODUCTION", "SALES", "PRODUCT", "CUSTOMER"];
const MAX_BYTES = 50 * 1024 * 1024;

export async function uploadAction(formData: FormData): Promise<UploadResponse> {
  const user = await getCurrentUser();
  if (!canUpload(user)) return { status: "error", message: "업로드 권한이 없습니다." };

  const kind = formData.get("kind");
  const file = formData.get("file");
  if (typeof kind !== "string" || !KINDS.includes(kind as UploadKind)) {
    return { status: "error", message: "업로드 종류가 잘못되었습니다." };
  }
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "파일을 선택하세요." };
  if (file.size > MAX_BYTES) return { status: "error", message: "파일이 50MB를 넘습니다." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const res = await processUpload(kind as UploadKind, file.name, bytes, user!.loginId);
  if (res.status === "saved") {
    revalidatePath("/upload");
    revalidatePath("/stock");
  }
  return res;
}
