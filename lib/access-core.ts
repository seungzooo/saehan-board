/**
 * 사내 조회 권한 — 순수 함수 (proxy.ts와 서버 코드 공용, next/headers 없음).
 *
 * - 열람 코드: 환경변수 VIEW_CODE. 맞히면 30일짜리 서명 쿠키 sb_view = "<만료 epoch초>.<HMAC-SHA256(VIEW_CODE, "view|"+만료)>".
 * - 관리 코드(UPLOAD_PIN) 세션 쿠키 sb_pin(12시간)이 유효해도 조회할 수 있다. 수정·업로드는 sb_pin만 허용(lib/pin.ts requirePin).
 * - 코드를 바꾸면 기존 쿠키는 모두 무효. 코드 값은 서버 환경변수에만 있고 클라이언트로 보내지 않는다.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const VIEW_COOKIE = "sb_view";
export const VIEW_SESSION_DAYS = 30;
export const PIN_COOKIE = "sb_pin";

export type Access = "ADMIN" | "VIEWER" | null;

const env = (k: string) => process.env[k]?.trim() || null;
export const configuredViewCode = () => env("VIEW_CODE");
export const configuredAdminCode = () => env("UPLOAD_PIN");

function mac(key: string, msg: string) {
  return createHmac("sha256", key).update(msg).digest("base64url");
}

/** prefix: 열람 쿠키 "view", 관리 쿠키 "v1"(lib/pin.ts와 같은 형식) */
export function signToken(key: string, prefix: string, expEpochSec: number): string {
  return `${expEpochSec}.${mac(key, `${prefix}|${expEpochSec}`)}`;
}

export function verifyToken(key: string | null, prefix: string, token: string | undefined, nowEpochSec = Math.floor(Date.now() / 1000)): boolean {
  if (!key || !token) return false;
  const [expRaw, m] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || !m || exp < nowEpochSec) return false;
  const a = Buffer.from(m);
  const b = Buffer.from(mac(key, `${prefix}|${exp}`));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function codeMatches(expected: string | null, input: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(input.trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 쿠키 읽기 함수를 받아 권한 판정 */
export function accessFrom(getCookie: (name: string) => string | undefined): Access {
  if (verifyToken(configuredAdminCode(), "v1", getCookie(PIN_COOKIE))) return "ADMIN";
  if (verifyToken(configuredViewCode(), "view", getCookie(VIEW_COOKIE))) return "VIEWER";
  return null;
}

/** 코드 없이 열리는 경로: 열람 코드 입력 화면과 정적 파일 */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/enter" || pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname === "/robots.txt";
}
