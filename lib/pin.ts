/**
 * 공용 PIN 보호 (서버 전용). 업로드·변동 입력·업로드 취소 화면과 그 서버 액션에 쓴다. 조회 화면은 공개.
 *
 * - PIN은 환경변수 UPLOAD_PIN. 없으면 보호 화면을 열지 않고 "관리자 PIN 미설정"을 보여준다 (열어 두지 않는다).
 * - PIN을 맞히면 세션 쿠키(httpOnly)를 발급: "<만료 epoch초>.<HMAC-SHA256(PIN, 'v1|'+만료)>".
 *   PIN을 바꾸면 기존 쿠키는 모두 무효가 된다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const PIN_COOKIE = "sb_pin";
export const PIN_SESSION_HOURS = 12;

export type PinState = "OK" | "LOCKED" | "UNSET";

export function configuredPin(): string | null {
  const pin = process.env.UPLOAD_PIN?.trim();
  return pin ? pin : null;
}

export function signSession(pin: string, expEpochSec: number): string {
  const mac = createHmac("sha256", pin).update(`v1|${expEpochSec}`).digest("base64url");
  return `${expEpochSec}.${mac}`;
}

export function verifySession(pin: string, token: string | undefined, nowEpochSec = Math.floor(Date.now() / 1000)): boolean {
  if (!token) return false;
  const [expRaw, mac] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || !mac || exp < nowEpochSec) return false;
  const expected = signSession(pin, exp).split(".")[1];
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pinMatches(pin: string, input: string): boolean {
  const a = Buffer.from(input.trim());
  const b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 현재 요청의 PIN 상태 */
export async function pinState(): Promise<PinState> {
  const pin = configuredPin();
  if (!pin) return "UNSET";
  const token = (await cookies()).get(PIN_COOKIE)?.value;
  return verifySession(pin, token) ? "OK" : "LOCKED";
}

/** 서버 액션 첫 줄에서 호출. 통과 못 하면 사용자에게 보여줄 메시지 */
export async function requirePin(): Promise<string | null> {
  const s = await pinState();
  if (s === "UNSET") return "관리 코드가 아직 정해지지 않았습니다. 생산지원팀에 문의하세요.";
  if (s === "LOCKED") return "관리자 확인이 필요합니다. 화면을 새로고침해 관리 코드를 입력하세요.";
  return null;
}

