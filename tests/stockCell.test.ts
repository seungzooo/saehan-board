import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import { stockCell } from "@/lib/analytics/stockCell";

const now = new Date("2026-11-03T12:00:00+09:00");
const at = new Date("2026-11-03T09:00:00+09:00");
const base = { baseline: 0, hasBaseline: true, deductions: { DEFECT: 0, SHIPMENT: 0, ORDER: 0, OTHER: 0 }, todayDeduction: 0, uploadedAt: at, stockAsOf: at };

describe("분석 표 현재 재고 칸: 실제 원인에 맞는 안내", () => {
  it("미등록(확인 필요) → 품목 상세, 소진 칸에 경고 반복 안 함", () => {
    const c = stockCell("X1", { ...base, available: null, uploadedAt: null, stockAsOf: null }, { days: null, avgPerDay: 0, basisTo: "2025-12-31", window: "30d" }, now);
    expect(c).toMatchObject({ state: "CHECK", text: "재고 확인 필요", days: null });
    expect(c.actions).toEqual([{ label: "재고 확인 필요 → 품목 상세", href: "/stock/X1" }]);
  });
  it("출고 없어 소진 산정 불가 → 비교 기간 출고 없음 → 출고 이력", () => {
    const c = stockCell("X2", { ...base, available: 30 }, { days: null, avgPerDay: 0, basisTo: "2025-12-31", window: "12m" }, now);
    expect(c.text).toBe("30박스");
    expect(c.sub).toBe("집계 11-03 09:00");
    expect(c.days).toEqual({ text: "소진 산정 불가" });
    expect(c.actions[0]).toEqual({ label: "비교 기간 출고 없음 → 출고 이력", href: "/analytics?code=X2" });
    expect(c.reasons.join(" ")).toContain("최근 12개월 일평균");
  });
  it("확인된 0은 미확인과 구분, 간헐 품목 12개월 평균 표시 유지", () => {
    const z = stockCell("X3", { ...base, available: 0 }, { days: 0, avgPerDay: 1, basisTo: "2025-12-31", window: "30d" }, now);
    expect(z).toMatchObject({ state: "ZERO", text: "0박스" });
    const m = stockCell("X4", { ...base, available: 40 }, { days: 40, avgPerDay: 1, basisTo: "2025-12-31", window: "12m" }, now);
    expect(m.days).toEqual({ text: "소진 40일 (12개월 평균)" });
  });
});
