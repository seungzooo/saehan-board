import { describe, expect, it } from "vitest";
import {
  bestLag,
  describeLag,
  describeNow,
  describeSeason,
  describeTrend,
  fillSeries,
  lagCorrelations,
  monthRange,
  pearson,
  seasonalIndex,
} from "@/lib/analytics/seasonal";

describe("monthRange / fillSeries", () => {
  it("연월 범위와 0 채움", () => {
    expect(monthRange("2024-11", "2025-02")).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
    expect(monthRange("2021-01", "2025-12")).toHaveLength(60);
    expect(fillSeries(["2025-01", "2025-02"], new Map([["2025-02", 5]]))).toEqual([0, 5]);
  });
});

describe("seasonalIndex", () => {
  it("월 평균 ÷ 전체 월 평균. 7·8월만 2배면 지수 > 1.2", () => {
    const months = monthRange("2021-01", "2025-12");
    const values = months.map((ym) => (["07", "08"].includes(ym.slice(5)) ? 200 : 100));
    const rows = seasonalIndex(months, values);
    const overall = (10 * 100 + 2 * 200) / 12;
    expect(rows[6].index).toBeCloseTo(200 / overall, 6);
    expect(rows[0].index).toBeCloseTo(100 / overall, 6);
    expect(rows[6].avg).toBe(200);
    expect(rows.reduce((s, r) => s + (r.index ?? 0), 0) / 12).toBeCloseTo(1, 6); // 지수 평균은 1
  });

  it("출고가 전혀 없으면 지수 null", () => {
    const months = monthRange("2025-01", "2025-12");
    expect(seasonalIndex(months, months.map(() => 0)).every((r) => r.index === null)).toBe(true);
  });
});

describe("pearson / lagCorrelations", () => {
  it("완전 양·음 상관, 분산 0이면 null", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });

  it("출고가 생산을 2개월 뒤 따라가면 시차 2의 상관이 가장 높다", () => {
    const prod = [5, 1, 9, 2, 7, 3, 8, 1, 6, 4, 9, 2, 5, 7, 1, 8];
    const ship = [0, 0, ...prod.slice(0, -2)]; // 2개월 지연
    const rows = lagCorrelations(prod, ship, 3);
    expect(rows.map((r) => r.lag)).toEqual([0, 1, 2, 3]);
    expect(rows[2].r).toBeCloseTo(1, 6);
    expect(bestLag(rows)?.lag).toBe(2);
    expect(rows[2].n).toBe(prod.length - 2);
  });
});

describe("해석 문장", () => {
  it("describeSeason: 연속 성수기는 범위로, 12~1월도 묶는다", () => {
    const months = monthRange("2021-01", "2025-12");
    const values = months.map((ym) => (["07", "08"].includes(ym.slice(5)) ? 200 : 100));
    expect(describeSeason(seasonalIndex(months, values))).toBe("7~8월 출고가 평균보다 71% 많음");

    const winter = months.map((ym) => (["12", "01"].includes(ym.slice(5)) ? 300 : 100));
    expect(describeSeason(seasonalIndex(months, winter))).toMatch(/^12~1월 출고가 평균보다/);

    const flat = months.map(() => 100);
    expect(describeSeason(seasonalIndex(months, flat))).toMatch(/^뚜렷한 성수기 없음/);
  });

  it("describeNow: 성수기·비수기·평균", () => {
    expect(describeNow(1.3, 7, 2.4)).toBe("지금은 성수기(7월 지수 1.30) → 소진이 평소보다 빨라질 수 있음 (현재 예상 소진 2.4일)");
    expect(describeNow(0.7, 1, null)).toMatch(/^지금은 비수기/);
    expect(describeNow(1.0, 3, 12.6)).toBe("지금은 평균 수준(3월 지수 1.00) (현재 예상 소진 13일)");
    expect(describeNow(null, 3, null)).toMatch(/산정 불가/);
  });

  it("describeLag / describeTrend", () => {
    expect(describeLag({ lag: 1, r: 0.62, n: 59 })).toBe("생산 후 1개월 뒤 출고 경향 (r=0.62, 상관 보통)");
    expect(describeLag({ lag: 0, r: 0.81, n: 60 })).toBe("생산한 달에 바로 출고되는 경향 (r=0.81, 상관 강함)");
    expect(describeLag(null)).toMatch(/산정할 수 없습니다/);
    const s = [...new Array(12).fill(100), ...new Array(12).fill(130)];
    expect(describeTrend(s)).toBe("최근 12개월 출고가 직전 12개월보다 30% 많음");
  });
});
