"use server";

import { prisma } from "@/lib/db";
import { requirePin } from "@/lib/pin";
import { revalidatePath } from "next/cache";

export type SaveNoteResult = { ok: true; note: { id: number; text: string; createdAt: string } } | { ok: false; message: string };

/** 탐지 결과에 메모 남기기 — 관리 코드 세션만 (열람 코드로는 거부) */
export async function saveEventNoteAction(eventId: string, text: string): Promise<SaveNoteResult> {
  const denied = await requirePin();
  if (denied) return { ok: false, message: denied };
  const t = text.trim().slice(0, 300);
  if (!t) return { ok: false, message: "메모 내용을 입력하세요." };
  const exists = await prisma.shipmentEvent.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!exists) return { ok: false, message: "해당 탐지 결과가 없습니다 (다시 계산되며 사라졌을 수 있음)." };
  const n = await prisma.shipmentEventNote.create({ data: { eventId, text: t, createdBy: "담당자" } });
  revalidatePath("/analytics", "layout");
  return { ok: true, note: { id: n.id, text: n.text, createdAt: n.createdAt.toISOString() } };
}
