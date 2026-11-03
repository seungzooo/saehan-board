"use server";

import { configuredPin, PIN_COOKIE, PIN_SESSION_HOURS, pinMatches, signSession } from "@/lib/pin";
import { cookies } from "next/headers";

export type PinLoginResult = { ok: true } | { ok: false; message: string };

/** PIN 입력 → 맞으면 세션 쿠키 발급 */
export async function pinLoginAction(formData: FormData): Promise<PinLoginResult> {
  const pin = configuredPin();
  if (!pin) return { ok: false, message: "관리자 PIN 미설정" };
  const input = String(formData.get("pin") ?? "");
  if (!pinMatches(pin, input)) {
    await new Promise((r) => setTimeout(r, 700)); // 무차별 대입 완화
    return { ok: false, message: "PIN이 맞지 않습니다." };
  }
  const exp = Math.floor(Date.now() / 1000) + PIN_SESSION_HOURS * 3600;
  (await cookies()).set(PIN_COOKIE, signSession(pin, exp), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PIN_SESSION_HOURS * 3600,
  });
  return { ok: true };
}

/** 잠금 — 세션 쿠키 삭제 */
export async function pinLogoutAction(): Promise<void> {
  (await cookies()).delete(PIN_COOKIE);
}
