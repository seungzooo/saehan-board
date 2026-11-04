import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import { industrySeasonView, industryView } from "@/lib/analytics/explain";
import { parseYearMonth } from "@/lib/excel/import";

describe("업계 지수 CSV 연월", () => {
  it("여러 표기를 YYYY-MM으로", () => {
    expect(["2021-01", "2021.01", "202101", "2021. 1", "2021년 1월", "2021/12"].map(parseYearMonth)).toEqual(["2021-01", "2021-01", "2021-01", "2021-01", "2021-01", "2021-12"]);
    expect(parseYearMonth("2021-13")).toBeNull();
    expect(parseYearMonth("abc")).toBeNull();
  });
});

describe("자사 vs 업계 전년 동월 대비 증가율 — 방향만, 원인 단정 없음", () => {
  const company = new Map([
    ["2024-01", 100],
    ["2024-02", 100],
    ["2025-01", 110], // +10%
    ["2025-02", 90], // −10%
  ]);
  const kosis = new Map([
    ["2024-01", 100],
    ["2024-02", 100],
    ["2025-01", 105], // +5%
    ["2025-02", 103], // +3%
  ]);
  const v = industryView(company, kosis, (ym) => ym <= "2025-02", "C222");
  it("같은 방향 / 다른 방향", () => {
    expect(v.months).toEqual(["2025-01", "2025-02"]);
    expect(v.table.rows).toEqual([
      ["2025년 1월", "+10%", "+5%", "시장과 같은 방향"],
      ["2025년 2월", "−10%", "+3%", "시장과 다른 방향"],
    ]);
    expect(v.sameCount).toBe(1);
    const all = JSON.stringify(v);
    expect(all).not.toMatch(/시장 요인|자사 요인|때문/);
  });
  it("자사 달이 집계 완료가 아니거나 전년 값이 없으면 비교하지 않음", () => {
    const w = industryView(company, kosis, (ym) => ym <= "2025-01", "C222");
    expect(w.months).toEqual(["2025-01"]);
  });
  it("계절지수 나란히", () => {
    const s = industrySeasonView(company, kosis, ["2025-01", "2025-02"], "C222");
    expect(s.points[0].values).toEqual([1.1, 1.01]);
    expect(s.points[2].values).toEqual([null, null]);
  });
});
