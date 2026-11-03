import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
import { pinMatches, signSession, verifySession } from "@/lib/pin";

describe("PIN 세션 토큰", () => {
  const now = 1_800_000_000;
  it("같은 PIN으로 서명한 미만료 토큰만 통과", () => {
    const t = signSession("482913", now + 3600);
    expect(verifySession("482913", t, now)).toBe(true);
    expect(verifySession("482913", t, now + 3601)).toBe(false); // 만료
    expect(verifySession("000000", t, now)).toBe(false); // PIN 변경 → 무효
    expect(verifySession("482913", undefined, now)).toBe(false);
    expect(verifySession("482913", "garbage", now)).toBe(false);
    const [exp, mac] = t.split(".");
    expect(verifySession("482913", `${Number(exp) + 99999}.${mac}`, now)).toBe(false); // 만료 시각 위조
  });
  it("PIN 비교", () => {
    expect(pinMatches("482913", " 482913 ")).toBe(true);
    expect(pinMatches("482913", "48291")).toBe(false);
    expect(pinMatches("482913", "482914")).toBe(false);
  });
});
