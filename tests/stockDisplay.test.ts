import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import { isDiscontinued, packLabel, productInfoText } from "@/lib/stockDisplay";

describe("packLabel — 포장 표시", () => {
  it("박스·파렛트·필름은 단위 이름으로", () => {
    expect(packLabel("박스", 105)).toBe("1박스당 105개");
    expect(packLabel("파렛트", 924)).toBe("1파렛트당 924개");
    expect(packLabel("필름", 1500)).toBe("1필름당 1,500개");
  });
  it("숫자*숫자 규격 코드는 1포장(코드)당", () => {
    expect(packLabel("83*155", 90)).toBe("1포장(83*155)당 90개");
    expect(packLabel("62*160", 320)).toBe("1포장(62*160)당 320개");
  });
  it("없음·빈 값은 입수", () => {
    expect(packLabel("없음", 105)).toBe("입수 105개");
    expect(packLabel("", 105)).toBe("입수 105개");
    expect(packLabel(null, 1)).toBe("입수 1개");
  });
  it("그 밖의 코드도 1포장(코드)당", () => {
    expect(packLabel("A14P", 6)).toBe("1포장(A14P)당 6개");
  });
  it("버그 재현 방지: '183*155당'·'1없음당'이 나오지 않는다", () => {
    const a = productInfoText({ code: "AM1", name: "캡", capacity: null, packUnit: "83*155", unitsPerBox: 500 });
    const b = productInfoText({ code: "AM2", name: "캡", capacity: null, packUnit: "없음", unitsPerBox: 500 });
    expect(a).not.toMatch(/183\*155당/);
    expect(b).not.toMatch(/1없음당/);
    expect(a).toBe("품번 AM1 · 1포장(83*155)당 500개");
    expect(b).toBe("품번 AM2 · 입수 500개");
  });
});

describe("isDiscontinued", () => {
  it("품명이 '폐기'로 시작하면 단종", () => {
    expect(isDiscontinued("폐기 - 쌀용기 2L")).toBe(true);
    expect(isDiscontinued("  폐기)CJ 1.8L")).toBe(true);
    expect(isDiscontinued("CJ 폐기물 용기")).toBe(false);
  });
});
