import { describe, expect, it } from "vitest";
import {
  allSeries,
  boxSizeOf,
  buildContext,
  compareRolling12,
  compareYear,
  describeComparison,
  formatUnits,
  monthStatus,
  yearSeries,
  yearSpan,
  yearsOf,
} from "@/lib/analytics/periods";

const months = (from: string, to: string) => {
  const out: string[] = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((m = 1), y++) : m++)
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};

describe("집계 완료 판단 — 마지막 출고일만으로 완료로 보지 않는다", () => {
  it("마지막 달은 확인값이 없으면 집계 중, 앞선 달은 완료", () => {
    const ctx = buildContext(months("2024-01", "2025-09"), null);
    expect(ctx.completeThrough).toBe("2025-08");
    expect(monthStatus("2025-09", ctx)).toBe("incomplete");
    expect(monthStatus("2025-08", ctx)).toBe("ok");
    expect(monthStatus("2025-10", ctx)).toBe("nodata");
    expect(monthStatus("2023-12", ctx)).toBe("nodata");
  });
  it("확인값이 마지막 달 이상이면 그 달까지 완료", () => {
    expect(buildContext(months("2024-01", "2025-09"), "2025-09").completeThrough).toBe("2025-09");
    expect(buildContext(months("2024-01", "2025-09"), "2025-12").completeThrough).toBe("2025-09");
  });
  it("범위 안 빈 달은 자료 누락", () => {
    const ctx = buildContext(months("2024-01", "2024-12").filter((m) => m !== "2024-06"), "2024-12");
    expect(monthStatus("2024-06", ctx)).toBe("missing");
  });
  it("연도 목록", () => {
    expect(yearsOf(buildContext(months("2021-03", "2025-09"), null))).toEqual([2021, 2022, 2023, 2024, 2025]);
  });
});

describe("연도별 1~12월 — 자료 없는 달은 끊고, 완료된 0은 0", () => {
  const ctx = buildContext(months("2024-01", "2025-09"), null); // 2025-09 집계 중
  const totals = new Map([["2025-01", 100], ["2025-03", 300]]); // 2025-02는 출고 0
  it("2025년: 1~8월 값(2월 0), 9월 집계 중·10~12월 자료 없음 → null", () => {
    const s = yearSeries(2025, totals, ctx);
    expect(s.map((p) => p.units)).toEqual([100, 0, 300, 0, 0, 0, 0, 0, null, null, null, null]);
    expect(s[8].status).toBe("incomplete");
    expect(s[9].status).toBe("nodata");
    expect(yearSpan(2025, ctx)).toEqual({ from: 1, to: 8 });
  });
  it("전체 기간은 첫 달~마지막 달", () => {
    const s = allSeries(totals, ctx);
    expect(s[0].ym).toBe("2024-01");
    expect(s.at(-1)!.ym).toBe("2025-09");
    expect(s.at(-1)!.units).toBeNull();
  });
});

describe("전년 동기간 비교", () => {
  it("2025년 1~9월까지 완료 → 2025년 1~9월 vs 2024년 1~9월", () => {
    const ctx = buildContext(months("2024-01", "2025-09"), "2025-09");
    const t = new Map<string, number>();
    for (const m of months("2024-01", "2024-12")) t.set(m, 100);
    for (const m of months("2025-01", "2025-09")) t.set(m, 110);
    const c = compareYear(2025, t, ctx);
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c.a).toMatchObject({ label: "2025년 1~9월", from: "2025-01", to: "2025-09", sum: 990 });
    expect(c.b).toMatchObject({ label: "2024년 1~9월", from: "2024-01", to: "2024-09", sum: 900 });
    expect(c.pct).toBeCloseTo(10, 10);
    expect(describeComparison(c, null)).toEqual(["2025년 1~9월 990개", "2024년 1~9월 900개", "전년 동기간 대비 +10.0%"]);
  });
  it("직전 합계가 작아도 0보다 크면 증감률을 그대로 보인다", () => {
    const ctx = buildContext(months("2024-01", "2025-12"), "2025-12");
    const t = new Map([["2024-05", 2], ["2025-05", 500]]);
    const c = compareYear(2025, t, ctx);
    expect(c.status).toBe("ok");
    expect(describeComparison(c, null)).toEqual(["2025년 1~12월 500개", "2024년 1~12월 2개", "전년 동기간 대비 +24900.0%"]);
  });
  it("직전 기간 0 → 증감률 산정 불가", () => {
    const ctx = buildContext(months("2024-01", "2025-12"), "2025-12");
    const c = compareYear(2025, new Map([["2025-03", 50]]), ctx);
    expect(c.status).toBe("prevZero");
    expect(describeComparison(c, null).at(-1)).toBe("이전 기간 출고 0 · 증감률 산정 불가");
  });
  it("첫 해(전년 자료 없음)·누락 달 → 비교 자료 부족", () => {
    const ctx = buildContext(months("2024-01", "2025-12"), "2025-12");
    expect(compareYear(2024, new Map([["2024-01", 1]]), ctx)).toMatchObject({ status: "insufficient", reason: "비교할 기간의 자료가 없음" });
    const gap = buildContext(months("2024-01", "2025-12").filter((m) => m !== "2024-04"), "2025-12");
    const c = compareYear(2025, new Map([["2025-01", 1], ["2024-01", 1]]), gap);
    expect(c).toMatchObject({ status: "insufficient", reason: "기간 안에 자료가 누락된 달이 있음" });
    expect(describeComparison(c, null).at(-1)).toBe("비교 자료 부족 — 기간 안에 자료가 누락된 달이 있음");
  });
});

describe("전체 기간: 최근 12개월 vs 직전 12개월 (집계 완료 마지막 달 기준)", () => {
  it("2025-09 집계 중이면 2024-09~2025-08 vs 2023-09~2024-08", () => {
    const ctx = buildContext(months("2023-01", "2025-09"), null);
    const t = new Map<string, number>(months("2023-01", "2025-09").map((m) => [m, m >= "2024-09" ? 20 : 10]));
    const c = compareRolling12(t, ctx);
    expect(c.status).toBe("ok");
    if (c.status !== "ok") return;
    expect(c.a).toMatchObject({ from: "2024-09", to: "2025-08", sum: 240, label: "2024-09~2025-08" });
    expect(c.b).toMatchObject({ from: "2023-09", to: "2024-08", sum: 120 });
    expect(c.pct).toBeCloseTo(100, 10);
    expect(describeComparison(c, null).at(-1)).toBe("직전 12개월 대비 +100.0%");
  });
  it("직전 12개월 자료가 모자라면 비교 자료 부족", () => {
    const ctx = buildContext(months("2025-01", "2025-12"), "2025-12");
    expect(compareRolling12(new Map(), ctx).status).toBe("insufficient");
  });
});

describe("단위", () => {
  it("박스로 확인되고 입수 > 0일 때만 박스 환산", () => {
    expect(boxSizeOf("박스", 100)).toBe(100);
    expect(boxSizeOf("83*155", 500)).toBeNull();
    expect(boxSizeOf("파렛트", 924)).toBeNull();
    expect(boxSizeOf("박스", 0)).toBeNull();
    expect(boxSizeOf("박스", null)).toBeNull();
  });
  it("250개 · 1박스 100개 → '2박스 50개'", () => {
    expect(formatUnits(250, 100)).toBe("2박스 50개");
    expect(formatUnits(300, 100)).toBe("3박스");
    expect(formatUnits(50, 100)).toBe("50개");
    expect(formatUnits(37900, 100)).toBe("379박스");
    expect(formatUnits(100320, null)).toBe("100,320개");
    expect(formatUnits(-250, 100)).toBe("−2박스 50개");
  });
});
