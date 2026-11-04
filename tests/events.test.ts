import { describe, expect, it } from "vitest";
import { detectEvents, groupEvents, type DailyRow } from "@/lib/events/detect";
import { detailOf, titleOf, weekText } from "@/lib/events/describe";
import { businessDays, holidaysIn } from "@/lib/events/calendar";

const months = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const [y, m] = from.split("-").map(Number);
    const k = y * 12 + m - 1 + i;
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  });
const M = months("2021-01", 48); // 2021-01 ~ 2024-12
const names = { product: (c: string) => `품목${c}` };

/** 거래처·품목별 월 수량 → 일별 행(그달 10일·20일에 나눠 출고) + 전사 바탕 거래처 */
function rowsOf(series: Record<string, (ym: string, i: number) => number>): DailyRow[] {
  const out: DailyRow[] = [];
  for (const [key, f] of Object.entries(series)) {
    const [customer, product] = key.split("/");
    M.forEach((ym, i) => {
      const v = f(ym, i);
      if (v > 0) {
        out.push({ date: `${ym}-10`, customer, product, units: Math.round(v / 2) });
        out.push({ date: `${ym}-20`, customer, product, units: v - Math.round(v / 2) });
      }
    });
  }
  return out;
}
const base = { "바탕/P0": () => 1_000_000 }; // 전사 규모 (실무 최소량 = 월 중앙값의 0.2% ≈ 2,000개)

describe("출고 변동 탐지", () => {
  it("유난히 많은 달: 평소 변동 폭과 실제 수량을 함께 봐서 잡는다", () => {
    const rows = rowsOf({ ...base, "A/P1": (ym) => (ym === "2024-06" ? 60_000 : 20_000) });
    const { events } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() });
    const e = events.find((x) => x.scope === "PAIR" && x.customer === "A" && x.kind === "SPIKE")!;
    expect(e).toBeTruthy();
    expect([e.periodStart, e.actual, e.baseline, e.diff]).toEqual(["2024-06", 60_000, 20_000, 40_000]);
    expect(e.baselineDesc).toBe("과거 같은 달(2021·2022·2023년) 중앙값");
    expect(titleOf(e, names)).toBe("2024년 6월, A의 품목P1(P1) 출고가 평소보다 40,000개 늘었습니다");
  });

  it("1개 → 3개처럼 작은 변화는 증가율이 커도 잡지 않는다", () => {
    const rows = rowsOf({ ...base, "B/P2": (ym) => (ym === "2024-06" ? 6 : 2) });
    const { events } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() });
    expect(events.filter((x) => x.customer === "B" || x.product === "P2")).toEqual([]);
  });

  it("꾸준히 나가던 거래처·품목이 3개월 이상 0 → 끊김, 간헐 출고 품목은 0이 이어져도 끊김이 아님", () => {
    const rows = rowsOf({
      ...base,
      "C/P3": (ym) => (ym >= "2024-07" ? 0 : 30_000), // 꾸준히 → 끊김
      "D/P4": (_ym, i) => (i % 4 === 0 && i < 40 ? 50_000 : 0), // 4개월에 한 번 (간헐)
    });
    const { events } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() });
    const stop = events.find((x) => x.kind === "STOP" && x.scope === "PAIR" && x.customer === "C")!;
    expect([stop.periodStart, stop.periodEnd, stop.extra.ongoing, stop.extra.zeroMonths]).toEqual(["2024-07", "2024-12", true, 6]);
    expect(titleOf(stop, names)).toBe("2024년 7월부터 C의 품목P3(P3) 출고가 6개월째 없습니다 (평소 월 30,000개)");
    expect(events.filter((x) => x.kind === "STOP" && (x.customer === "D" || x.product === "P4"))).toEqual([]);
    expect(events.filter((x) => (x.kind === "SPIKE" || x.kind === "DROP") && (x.customer === "D" || x.product === "P4"))).toEqual([]);
  });

  it("자료 누락 달(완료 달인데 전사 행 없음)은 실제 0과 구분해 검사에서 뺀다", () => {
    const rows = rowsOf({ ...base, "E/P5": () => 30_000 }).filter((r) => !r.date.startsWith("2024-03"));
    const { events, missingMonths } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() });
    expect(missingMonths).toEqual(["2024-03"]);
    expect(events.filter((x) => x.periodStart === "2024-03" || x.kind === "STOP")).toEqual([]);
  });

  it("연속된 달의 같은 방향 급변은 한 건, 전사 변화는 가장 크게 기여한 대상과 한 묶음", () => {
    const rows = rowsOf({ ...base, "F/P6": (ym) => (ym >= "2024-05" && ym <= "2024-07" ? 400_000 : 100_000) });
    const { events } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() });
    const pair = events.find((x) => x.scope === "PAIR" && x.customer === "F" && x.kind === "SPIKE")!;
    expect([pair.periodStart, pair.periodEnd, pair.diff]).toEqual(["2024-05", "2024-07", 900_000]);
    expect(titleOf(pair, names)).toBe("2024년 5월~2024년 7월, F의 품목P6(P6) 출고가 3개월 연속 평소보다 많았습니다 (합계 900,000개 더)");
    const groups = groupEvents(events);
    const g = groups.find((x) => x.members.some((m) => m.id === pair.id))!;
    expect(g.lead.scope).toBe("PAIR"); // 가장 구체적인 대상이 대표
    // 전사로는 +27%라 기준(평소의 50% 이상)에 못 미침 — 전사 합계에 가려진 거래처·품목 변화
    expect(g.members.map((m) => m.scope).sort()).toEqual(["CUSTOMER", "PAIR", "PRODUCT"]);
    expect(events.filter((x) => x.scope === "ALL" && x.grain === "MONTH")).toEqual([]);
  });

  it("전사 변화가 한 거래처·품목에 몰리면 한 묶음 + '집중' 표시", () => {
    const rows = rowsOf({ ...base, "F/P6": (ym) => (ym === "2024-05" ? 1_600_000 : 100_000) });
    const { events } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() });
    const all = events.find((x) => x.scope === "ALL" && x.grain === "MONTH")!;
    expect(all.diff).toBe(1_500_000);
    const g = groupEvents(events).find((x) => x.members.includes(all))!;
    expect(g.lead.scope).toBe("PAIR");
    expect(g.members.map((m) => m.scope).sort()).toEqual(["ALL", "CUSTOMER", "PAIR", "PRODUCT"]);
    const d = detailOf(all, names, { monthEndProducts: new Set() });
    expect(d.contributors[0]).toMatch(/^전사 차이의 100%가 (거래처 F|품목 품목P6) 한 곳에 집중$/);
  });

  it("월말 일괄 기록 품목은 주 단위 판정에서 뺀다", () => {
    const rows = rowsOf(base);
    // 월말에만 한 번에 기록되는 큰 품목
    for (const ym of M) {
      const [y, m] = ym.split("-").map(Number);
      rows.push({ date: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10), customer: "G", product: "PME", units: 3_000_000 });
    }
    const { events } = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set(["PME"]) });
    expect(events.filter((x) => x.grain === "WEEK")).toEqual([]);
  });
});

describe("달력 (사실만, 원인 단정 없음)", () => {
  it("영업일·공휴일", () => {
    expect(businessDays("2024-09-16", "2024-09-22")).toBe(2); // 추석 연휴 16~18
    expect(holidaysIn("2024-09-01", "2024-09-30").map((h) => h.date)).toEqual(["2024-09-16", "2024-09-17", "2024-09-18"]);
    expect(weekText("2024-09-16")).toBe("2024년 9월 3주(9/16~9/22)");
  });
  it("확인할 점: 다음 행동 제시, 원인을 판단하지 않았다고 밝힘", () => {
    const rows = rowsOf({ ...base, "A/P1": (ym) => (ym === "2024-09" ? 60_000 : 20_000) });
    const e = detectEvents({ rows, completeMonths: M, monthEndProducts: new Set() }).events.find((x) => x.scope === "PAIR" && x.kind === "SPIKE")!;
    const d = detailOf(e, names, { monthEndProducts: new Set() });
    expect(d.calendar.join(" ")).toContain("기간 안 공휴일: 9/16 추석 연휴, 9/17 추석, 9/18 추석 연휴");
    expect(d.calendar.at(-1)).toBe("공휴일·영업일은 날짜가 겹친다는 사실일 뿐 변동의 원인으로 확인된 것은 아닙니다.");
    expect(d.checks).toContain("해당 거래처(A) 발주 내역 확인");
    expect(JSON.stringify(d)).not.toMatch(/명절 수요|때문에/);
  });
});
