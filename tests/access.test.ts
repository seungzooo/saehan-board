import { afterEach, describe, expect, it } from "vitest";
import { accessFrom, codeMatches, isPublicPath, PIN_COOKIE, signToken, verifyToken, VIEW_COOKIE } from "@/lib/access-core";

// 테스트 전용 가짜 코드 (실제 값과 무관)
const VIEW = "111222";
const ADMIN = "333444";
const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("사내 조회 권한 쿠키", () => {
  const now = 1_800_000_000;
  it("같은 코드로 서명한 미만료 토큰만 통과, 위조·만료·코드 변경은 거부", () => {
    const t = signToken(VIEW, "view", now + 30 * 86400);
    expect(verifyToken(VIEW, "view", t, now)).toBe(true);
    expect(verifyToken(VIEW, "view", t, now + 31 * 86400)).toBe(false); // 30일 지나면 만료
    expect(verifyToken("999999", "view", t, now)).toBe(false); // 코드 변경 → 무효
    expect(verifyToken(VIEW, "view", `${now + 100}.forged`, now)).toBe(false);
    expect(verifyToken(VIEW, "view", undefined, now)).toBe(false);
    expect(verifyToken(null, "view", t, now)).toBe(false); // 코드 미설정이면 아무도 통과 못 함
  });

  it("열람 쿠키는 관리 권한이 되지 않는다 (용도 구분)", () => {
    process.env.VIEW_CODE = VIEW;
    process.env.UPLOAD_PIN = ADMIN;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const viewTok = signToken(VIEW, "view", exp);
    const adminTok = signToken(ADMIN, "v1", exp);
    const jar = (c: Record<string, string>) => (n: string) => c[n];
    expect(accessFrom(jar({ [VIEW_COOKIE]: viewTok }))).toBe("VIEWER");
    expect(accessFrom(jar({ [PIN_COOKIE]: adminTok }))).toBe("ADMIN");
    expect(accessFrom(jar({ [PIN_COOKIE]: viewTok }))).toBe(null); // 열람 토큰을 관리 쿠키 자리에 넣어도 거부
    expect(accessFrom(jar({}))).toBe(null);
  });

  it("코드 비교와 공개 경로", () => {
    expect(codeMatches(VIEW, ` ${VIEW} `)).toBe(true);
    expect(codeMatches(VIEW, "111223")).toBe(false);
    expect(codeMatches(null, "")).toBe(false);
    expect(isPublicPath("/enter")).toBe(true);
    expect(isPublicPath("/_next/static/x.js")).toBe(true);
    for (const p of ["/", "/stock", "/analytics", "/upload", "/enter-x"]) expect(isPublicPath(p)).toBe(false);
  });
});
