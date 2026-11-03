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
