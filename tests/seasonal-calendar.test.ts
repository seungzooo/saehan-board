import { describe, expect, it } from "vitest";
import { bestLag, coveredSeries, describeYearly, lagCorrelationsCalendar, monthRange, yearlySeasonal } from "@/lib/analytics/seasonal";

describe("coveredSeries — 실제 0과 자료 없음 구분", () => {
  it("범위 안 빈 달 = 0, 범위 밖 = null", () => {
    const months = monthRange("2024-11", "2025-02");
    const v = new Map([["2024-12", 5]]);
    expect(coveredSeries(months, v, { from: "2024-12", to: "2025-01" })).toEqual([null, 5, 0, null]);
    expect(coveredSeries(months, v, null)).toEqual([null, null, null, null]);
  });
});

describe("lagCorrelationsCalendar — 방향: 생산월 t ↔ 출고월 t+k", () => {
  // 손으로 확인 가능한 예: 출고가 생산을 정확히 2개월 뒤 따라간다
  const prod = [10, 0, 30, 0, 50, 0, 20, 0, 40, 0, 60, 0];
  const ship = [0, 0, 10, 0, 30, 0, 50, 0, 20, 0, 40, 0]; // ship[t+2] = prod[t]

  it("k=2에서 r=1, 최고 시차 = 2 (출고가 생산보다 늦다 → 양의 k)", () => {
    const rows = lagCorrelationsCalendar(prod, ship, 6);
    expect(rows.map((r) => r.lag)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows[2].r).toBeCloseTo(1, 10);
    expect(bestLag(rows)?.lag).toBe(2);
  });

  it("반대 방향(출고가 먼저)이면 양의 k에서 r=1이 나오지 않는다", () => {
    const rows = lagCorrelationsCalendar(ship, prod, 6); // 생산 자리에 늦은 시계열
    expect(rows[2].r).not.toBeCloseTo(1, 3);
  });

  it("유효 월 쌍 수: 길이 12, k=6 → 6쌍. 자료 없음 달은 쌍에서 빠진다", () => {
    const rows = lagCorrelationsCalendar(prod, ship, 6);
    expect(rows.map((r) => r.n)).toEqual([12, 11, 10, 9, 8, 7, 6]);
    const shipGap = [...ship];
    shipGap[4] = null as unknown as number; // 출고 자료 없음 1달
    const r2 = lagCorrelationsCalendar(prod, shipGap as (number | null)[], 2);
    expect(r2[2].n).toBe(9); // t=2 쌍(prod[2], ship[4])이 빠짐
  });

  it("손 계산 검산: 쌍 (1,2),(2,4),(3,5) → r = 0.9820", () => {
    // x = [1,2,3], y = [2,4,5]: mean x 2, mean y 11/3
    // cov = (−1)(−5/3)+0+(1)(4/3) = 3, vx = 2, vy = 25/9+1/9+16/9 = 42/9 → r = 3/√(2·42/9) = 0.98198
    const rows = lagCorrelationsCalendar([1, 2, 3, null], [null, 2, 4, 5], 1);
    expect(rows[1].n).toBe(3);
    expect(rows[1].r).toBeCloseTo(0.98198, 4);
    expect(rows[0].n).toBe(2); // k=0: (2,2),(3,4)만 유효 → r 산정 불가
    expect(rows[0].r).toBeNull();
  });

  it("분산 0이면 r = null (0으로 바꾸지 않는다)", () => {
    expect(lagCorrelationsCalendar([5, 5, 5, 5], [1, 2, 3, 4], 0)[0].r).toBeNull();
  });
});

describe("yearlySeasonal — 해당 월 ÷ 해당 연도 월평균 (기준 1)", () => {
  it("손 계산: 2024년 매달 100, 7월만 400 → 연평균 125, 7월 3.2, 1월 0.8", () => {
    const months = monthRange("2024-01", "2024-12");
    const v = months.map((ym) => (ym.endsWith("-07") ? 400 : 100));
    const [y] = yearlySeasonal(months, v);
    expect(y).toMatchObject({ year: 2024, covered: 12, status: "ok" });
    expect(y.mean).toBe(125);
    expect(y.cells[6].index).toBeCloseTo(3.2, 10);
    expect(y.cells[0].index).toBeCloseTo(0.8, 10);
    expect(y.cells.reduce((s, c) => s + (c.index ?? 0), 0) / 12).toBeCloseTo(1, 10);
  });

  it("실제 출고 0인 달은 지수 0, 자료 없음 달은 null — 구분된다", () => {
    const months = monthRange("2025-01", "2025-04");
    const [y] = yearlySeasonal(months, [0, 200, null, 100]); // 3월 자료 없음
    expect(y.covered).toBe(3);
    expect(y.mean).toBe(100); // (0+200+100)/3 — 12로 나누지 않는다
    expect(y.cells[0]).toMatchObject({ value: 0, index: 0 });
    expect(y.cells[2]).toMatchObject({ value: null, index: null });
    expect(y.cells[11]).toMatchObject({ value: null, index: null }); // 범위 밖 달
  });

  it("연 출고가 0이면 그 해 지수는 전부 null (status=zero), 자료가 없는 해는 nodata", () => {
    const months = monthRange("2023-01", "2024-12");
    const v = months.map((ym) => (ym.startsWith("2023") ? 0 : null));
    const rows = yearlySeasonal(months, v);
    expect(rows[0]).toMatchObject({ year: 2023, status: "zero", mean: 0 });
    expect(rows[0].cells.every((c) => c.index === null && c.value === 0)).toBe(true);
    expect(rows[1]).toMatchObject({ year: 2024, status: "nodata", mean: null, covered: 0 });
  });
});

describe("describeYearly", () => {
  it("3개 해 중 2개 해의 7월이 1.2 이상 → 반복 패턴", () => {
    const months = monthRange("2023-01", "2025-12");
    const v = months.map((ym) => (ym.endsWith("-07") && ym < "2025" ? 300 : 100));
    expect(describeYearly(yearlySeasonal(months, v))).toBe("7월은 3개 해 중 2개 해에서 성수기(지수 1.2 이상) — 해마다 반복되는 패턴입니다.");
  });
  it("성수기 달이 해마다 다르면 일정하지 않음", () => {
    const months = monthRange("2024-01", "2025-12");
    const v = months.map((ym) => (ym === "2024-03" || ym === "2025-09" ? 300 : 100));
    expect(describeYearly(yearlySeasonal(months, v))).toMatch(/계절 패턴이 일정하지 않습니다/);
  });
});
