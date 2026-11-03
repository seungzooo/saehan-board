import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import { seasonMonths } from "@/lib/analytics/query";

describe("계절지수 분석 기간은 자료 범위를 따라간다 (고정 연도 없음)", () => {
  it("현재 자료 2021-01~2025-12 → 그대로 60개 달", () => {
    const m = seasonMonths({ from: "2021-01", to: "2025-12" });
    expect([m[0], m.at(-1), m.length]).toEqual(["2021-01", "2025-12", 60]);
  });
  it("새 실적을 올려 집계 완료가 2026-06까지 늘면 최근 60개 달 2021-07~2026-06", () => {
    const m = seasonMonths({ from: "2021-01", to: "2026-06" });
    expect([m[0], m.at(-1), m.length]).toEqual(["2021-07", "2026-06", 60]);
  });
  it("자료가 5년보다 짧으면 있는 만큼", () => {
    expect(seasonMonths({ from: "2024-03", to: "2025-12" }).length).toBe(22);
    expect(seasonMonths(null)).toEqual([]);
  });
});
