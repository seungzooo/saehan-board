"use server";

import { codeMatches, configuredAdminCode, configuredViewCode, PIN_COOKIE, signToken, VIEW_COOKIE, VIEW_SESSION_DAYS } from "@/lib/access-core";
import { PIN_SESSION_HOURS } from "@/lib/pin";
import { cookies } from "next/headers";

export type EnterResult = { ok: true; next: string } | { ok: false; message: string };

/** 열람 코드(조회 30일) 또는 관리 코드(조회 30일 + 관리 12시간) 입력 */
export async function enterAction(formData: FormData): Promise<EnterResult> {
  const input = String(formData.get("code") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));
  const view = configuredViewCode();
  const admin = configuredAdminCode();
  if (!view) return { ok: false, message: "열람 코드가 아직 정해지지 않았습니다. 생산지원팀에 문의하세요." };
  const isAdmin = codeMatches(admin, input);
  const isViewer = codeMatches(view, input);
  if (!isAdmin && !isViewer) {
    await new Promise((r) => setTimeout(r, 700)); // 무차별 대입 완화
    return { ok: false, message: "코드가 맞지 않습니다." };
  }
  const now = Math.floor(Date.now() / 1000);
  const jar = await cookies();
  const base = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
  jar.set(VIEW_COOKIE, signToken(view, "view", now + VIEW_SESSION_DAYS * 86400), { ...base, maxAge: VIEW_SESSION_DAYS * 86400 });
  if (isAdmin && admin) jar.set(PIN_COOKIE, signToken(admin, "v1", now + PIN_SESSION_HOURS * 3600), { ...base, maxAge: PIN_SESSION_HOURS * 3600 });
  return { ok: true, next };
}

/** 같은 사이트 안의 경로만 (오픈 리다이렉트 방지) */
function safeNext(n: string): string {
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/enter") ? n : "/";
}
