import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import { INTERMITTENT_NOTE, isIntermittent, isMonthEnd, isMonthEndOnly, MONTH_END_NOTE, summarizeItem, summaryLine, type ItemShipRow } from "@/lib/analytics/itemStats";
import { chooseRate } from "@/lib/stock";
import { daysNumText, rateLabel } from "@/lib/stockDisplay";
import { monthEmptyText } from "@/components/charts";

const year2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);

describe("품목 출고 요약 한 줄", () => {
  it("2025년 출고 5회 · 거래처 1곳(강남주조) · 출고한 달 5/12", () => {
    const rows: ItemShipRow[] = [
      ["2025-01", "강남주조", 1],
      ["2025-03", "강남주조", 1],
      ["2025-06", "강남주조", 1],
      ["2025-09", "강남주조", 1],
      ["2025-12", "강남주조", 1],
      ["2024-12", "다른곳", 4], // 기간 밖은 세지 않는다
    ];
    const s = summarizeItem(rows, year2025);
    expect(summaryLine("2025년", s)).toBe("2025년 출고 5회 · 거래처 1곳(강남주조) · 출고한 달 5/12");
    expect(isIntermittent(s)).toBe(true); // 5/12 ≤ 절반
  });

  it("거래처 3곳까지는 이름, 4곳 이상은 수만. 분모는 집계 완료된 달만", () => {
    const rows: ItemShipRow[] = ["가", "나", "다"].map((c, i) => [`2025-0${i + 1}`, c, 2] as ItemShipRow);
    expect(summaryLine("2025년", summarizeItem(rows, year2025.slice(0, 9)))).toBe("2025년 출고 6회 · 거래처 3곳(가, 나, 다) · 출고한 달 3/9");
    const four: ItemShipRow[] = [...rows, ["2025-04", "라", 1]];
    expect(summaryLine("2025년", summarizeItem(four, year2025))).toBe("2025년 출고 7회 · 거래처 4곳 · 출고한 달 4/12");
  });

  it("간헐 판정: 절반 이하만 (6/12는 간헐, 7/12는 아님), 기간이 없으면 아님", () => {
    const mk = (n: number) => summarizeItem(year2025.slice(0, n).map((ym) => [ym, "A", 1] as ItemShipRow), year2025);
    expect(isIntermittent(mk(6))).toBe(true);
    expect(isIntermittent(mk(7))).toBe(false);
    expect(isIntermittent(summarizeItem([], []))).toBe(false);
    expect(INTERMITTENT_NOTE).toBe("간헐 출고 품목 — 월별 증감률보다 연간 합계로 비교하세요");
  });

  it("월말 일괄 기록: 2건 이상이고 전부 그달 마지막 날 (윤년 2월 포함)", () => {
    expect(isMonthEnd("2025-03-31")).toBe(true);
    expect(isMonthEnd("2024-02-29")).toBe(true);
    expect(isMonthEnd("2025-02-28")).toBe(true);
    expect(isMonthEnd("2025-03-30")).toBe(false);
    expect(isMonthEndOnly({ shipments: 5, monthEndShipments: 5 })).toBe(true);
    expect(isMonthEndOnly({ shipments: 5, monthEndShipments: 4 })).toBe(false);
    expect(isMonthEndOnly({ shipments: 1, monthEndShipments: 1 })).toBe(false);
    expect(MONTH_END_NOTE).toBe("월말 일괄 기록 품목 — 실제 출고 시점과 다를 수 있음");
  });
});

describe("월 툴팁: 출고 없음(실제 0) ↔ 자료 없음 구분", () => {
  it("0은 '출고 없음', 값 없음은 '자료 없음'", () => {
    expect(monthEmptyText({ ym: "2025-03", units: 0, status: "ok" })).toBe("2025년 3월 · 출고 없음");
    expect(monthEmptyText({ ym: "2026-03", units: null, status: "incomplete" })).toBe("2026년 3월 · 자료 없음 (집계 중)");
    expect(monthEmptyText({ ym: "2020-03", units: null, status: "nodata" })).toBe("2020년 3월 · 자료 없음");
    expect(monthEmptyText({ ym: "2025-04", units: 120, status: "ok" })).toBeNull();
  });
});

describe("소진일수 산정: 간헐 출고 품목은 최근 12개월 일평균", () => {
  it("출고한 달 6개 이하 → 12개월 평균, 7개 이상 → 30일 평균", () => {
    // 최근 30일 출고 0이어도 12개월에 3달 출고 → 12개월 평균으로 산정 (30일 기준이면 산정 불가였음)
    expect(chooseRate(0, 365, 365, 3)).toEqual({ avgPerDay: 1, window: "12m", shippedMonths: 3 });
    expect(chooseRate(60, 365, 365, 6).window).toBe("12m");
    expect(chooseRate(60, 3650, 365, 7)).toEqual({ avgPerDay: 2, window: "30d", shippedMonths: 7 });
  });
  it("표시: '(12개월 평균)' 붙임, 30일은 그대로", () => {
    expect(daysNumText(40.4, "12m")).toBe("40일 (12개월 평균)");
    expect(daysNumText(2.46, "30d")).toBe("2.5일");
    expect(daysNumText(null, "12m")).toBe("산정 불가");
    expect(rateLabel("12m")).toBe("최근 12개월 일평균");
    expect(rateLabel("30d")).toBe("최근 30일 일평균");
  });
});
