import { describe, expect, it } from "vitest";
import { changeText, monthView, seasonAvgView, trendView } from "@/lib/analytics/explain";
import type { MonthPoint } from "@/lib/analytics/periods";

const pt = (ym: string, units: number | null, status: MonthPoint["status"] = "ok"): MonthPoint => ({ month: Number(ym.slice(5)), ym, units, status });

describe("월별 출고: 선택 설명과 표가 같은 값", () => {
  const normal = new Map([
    ["2024-03", 100],
    ["2025-03", 120],
    ["2025-04", 0],
  ]);
  const done = (ym: string) => ym <= "2025-04";
  const v = monthView([pt("2025-03", 120), pt("2025-04", 0), pt("2025-05", null, "incomplete")], normal, null, { labelMode: "month", isComplete: done });

  it("값·전년 같은 달·증감", () => {
    expect(v.points[0].detail).toEqual({ title: "2025년 3월", lines: ["정상 출고 120개", "전년 같은 달(2024년 3월) 100개 · +20%"] });
    expect(v.table.rows[0]).toEqual(["2025년 3월", "120개", "100개", "+20%"]);
  });
  it("집계 완료된 0 = 출고 없음, 값 없는 달 = 자료 없음 (구분)", () => {
    expect(v.points[1].detail.lines[0]).toBe("출고 없음 (집계 완료된 실제 0)");
    expect(v.points[1].detail.lines[1]).toBe("전년 같은 달(2024년 4월) 0개 · 변화 없음 (둘 다 0)");
    expect(v.points[2].detail.lines).toEqual(["자료 없음 (집계 중)"]);
    expect(v.points[2].values).toEqual([null]);
    expect(v.table.rows[2]).toEqual(["2025년 5월", "자료 없음 (집계 중)", "—", "—"]);
  });
  it("전년 같은 달이 집계 완료가 아니면 비교하지 않는다 (0으로 채우지 않음)", () => {
    const w = monthView([pt("2025-03", 120)], normal, null, { labelMode: "month", isComplete: (ym) => ym >= "2025-01" });
    expect(w.points[0].detail.lines).toEqual(["정상 출고 120개"]);
  });
  it("품목이면 그 달 거래처", () => {
    const w = monthView([pt("2025-03", 120)], normal, null, { labelMode: "month", isComplete: done, itemRows: [["2025-03", "강남주조", 2]] });
    expect(w.points[0].detail.lines.at(-1)).toBe("거래처 1곳: 강남주조 2회");
  });
  it("증감률 기준 0", () => {
    expect(changeText(5, 0)).toBe("전년 0 → 증감률 산정 불가");
    expect(changeText(80, 100)).toBe("−20%");
  });
});

describe("품목 차트 설명", () => {
  it("생산·출고 같은 달 비교는 합계 비교임을 밝힌다", () => {
    const t = trendView([{ yearMonth: "2025-01", production: 200, shipment: 100 }], null);
    expect(t.points[0].detail.lines[1]).toBe("출고 ÷ 생산 = 50% (같은 달 합계 비교, 개별 로트 추적 아님)");
    expect(t.table.rows[0]).toEqual(["2025년 1월", "200개", "100개"]);
  });
  it("5년 평균 계절지수: 평소의 몇 배", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, index: i === 6 ? 2 : 10 / 11, avg: i === 6 ? 20 : 10 }));
    const s = seasonAvgView(rows, "박스", 1.2);
    expect(s.points[6].highlight).toBe(true);
    expect(s.points[6].detail.lines[1]).toBe("평소(전체 월평균)의 2.00배 = +100% · 성수기");
  });
});

import { yearlyTotalsView } from "@/lib/analytics/explain";
describe("연도별 합계와 전년 대비 증가율", () => {
  const normal = new Map<string, number>();
  for (let m = 1; m <= 12; m++) {
    normal.set(`2024-${String(m).padStart(2, "0")}`, 100);
    normal.set(`2025-${String(m).padStart(2, "0")}`, 110);
  }
  normal.set("2026-01", 50);
  const done = (ym: string) => ym >= "2024-01" && ym <= "2026-01";
  const v = yearlyTotalsView([2024, 2025, 2026], normal, done, null);
  it("완료된 해는 1~12월 합계와 증가율", () => {
    expect(v.table.rows[0]).toEqual(["2024년", "1,200개", "1~12월", "—"]); // 2023 자료 없음
    expect(v.table.rows[1]).toEqual(["2025년", "1,320개", "1~12월", "+10%"]);
    expect(v.points[1].label).toBe("2025 +10%");
  });
  it("일부 달만 완료된 해는 전년 같은 달끼리 (동기간)", () => {
    expect(v.table.rows[2]).toEqual(["2026년", "50개", "1월", "−55%"]);
    expect(v.points[2].detail.lines[1]).toBe("전년 1월 동기간 110개 대비 −55%");
  });
});

import { heatCell, peakPattern } from "@/lib/analytics/explain";
describe("히트맵 셀: 반올림 전 지수로 낸 월평균 대비 차이, 0·자료 없음·기준 0 구분", () => {
  it("+20% 와 개수 문장", () => {
    const c = heatCell(2023, 7, 1204, 1000, "ok", "개");
    expect(c.text).toBe("+20%"); // 1.204 → +20% (반올림 전 1.204로 계산)
    expect(c.lines[0]).toBe("실제 출고 1,204개 · 그해 월평균 1,000개 · 차이 +204개 (+20%)");
    expect(c.lines[1]).toBe("그해 평소보다 20% 많이 출고됐습니다.");
    expect(heatCell(2023, 7, 1196, 1000, "ok", "개").text).toBe("+20%");
    expect(heatCell(2023, 7, 994, 1000, "ok", "개").text).toBe("−1%");
  });
  it("실제 0 / 자료 없음 / 기준값 0", () => {
    expect(heatCell(2023, 2, 0, 500, "ok", "개")).toMatchObject({ kind: "zero", text: "없음" });
    expect(heatCell(2023, 2, 0, 500, "ok", "개").lines[0]).toBe("출고 없음 (실제 0) · 그해 월평균 500개 · 차이 −500개 (−100%)");
    expect(heatCell(2026, 5, null, 500, "ok", "개")).toMatchObject({ kind: "nodata", text: "—" });
    expect(heatCell(2022, 5, 0, 0, "zero", "개")).toMatchObject({ kind: "base0", text: "×" });
  });
});

describe("계절 TOP 10 근거: 반복 성수기와 한 해 대량 출고 구분", () => {
  const yrs = (vals: number[], mean = 10) => vals.map((v, i) => ({ year: 2021 + i, value: v, yearMean: mean, complete: true }));
  it("5년 중 4년 이상 그해 월평균 초과 → 반복 성수기 배지", () => {
    const p = peakPattern({ month: 7, overallMean: 10, monthMean: 20, years: yrs([20, 18, 25, 5, 22]) });
    expect(p).toMatchObject({ kind: "repeat", over: 4, comparable: 5, badge: true });
  });
  it("한 해에 몰린 대량 출고 → 한 해 집중", () => {
    const p = peakPattern({ month: 3, overallMean: 10, monthMean: 40, years: yrs([0, 0, 190, 5, 5]) });
    expect(p.kind).toBe("spike");
    expect(p.label).toBe("한 해 대량 출고로 높아짐 — 2023년 3월이 5년 같은 달 합계의 95%");
    expect(p.badge).toBe(false);
  });
  it("일부 달만 있는 해·그해 출고 0인 해는 분모에서 제외", () => {
    const years = [...yrs([20, 20, 20]), { year: 2024, value: 20, yearMean: 10, complete: false }, { year: 2025, value: 0, yearMean: 0, complete: true }];
    expect(peakPattern({ month: 7, overallMean: 10, monthMean: 16, years })).toMatchObject({ over: 3, comparable: 3, badge: false });
  });
});
