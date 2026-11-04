/**
 * 탐지 결과를 사람이 읽는 문장으로 — "실제로 변한 것"과 "관련 일정·확인할 점"을 나눈다 (테스트 tests/events.test.ts).
 * 원인을 단정하지 않는다: 공휴일·연휴는 날짜가 겹친다는 사실과 영업일 수만 적고, 회사 휴무·판촉·발주 변경은 기록이 없어 연결하지 않는다.
 */
import { businessDays, calendarCovers, holidaysIn, holidaysNear, monthRangeOf } from "./calendar";
import type { DetectedEvent } from "./detect";

const n = (v: number) => Math.round(Math.abs(v)).toLocaleString("ko-KR");
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${n(v)}`;
const ymText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 주: 그 주 목요일이 속한 달의 몇째 주 — "2024년 9월 3주(9/16~9/22)" */
export function weekText(monday: string): string {
  const thu = new Date(Date.parse(`${monday}T00:00:00Z`) + 3 * 86400_000).toISOString().slice(0, 10);
  const nth = Math.ceil(Number(thu.slice(8, 10)) / 7);
  const sun = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
  return `${thu.slice(0, 4)}년 ${Number(thu.slice(5, 7))}월 ${nth}주(${md(monday)}~${md(sun)})`;
}

export function periodText(e: Pick<DetectedEvent, "grain" | "periodStart" | "periodEnd">): string {
  if (e.grain === "WEEK") return weekText(e.periodStart);
  return e.periodStart === e.periodEnd ? ymText(e.periodStart) : `${ymText(e.periodStart)}~${ymText(e.periodEnd)}`;
}

export type Names = { product: (code: string) => string };

export function subjectText(e: Pick<DetectedEvent, "scope" | "customer" | "product">, names: Names): string {
  if (e.scope === "ALL") return "전사";
  if (e.scope === "CUSTOMER") return `${e.customer}`;
  if (e.scope === "PRODUCT") return `${names.product(e.product!)}(${e.product})`;
  return `${e.customer}의 ${names.product(e.product!)}(${e.product})`;
}

export const KIND_LABEL: Record<DetectedEvent["kind"], string> = {
  SPIKE: "유난히 많음",
  DROP: "유난히 적음",
  STOP: "출고 끊김",
  RESUME: "출고 재개",
  TREND_UP: "계속 증가",
  TREND_DOWN: "계속 감소",
  SEASON_UP: "해마다 같은 달 증가",
  SEASON_DOWN: "해마다 같은 달 감소",
};

export function titleOf(e: DetectedEvent, names: Names): string {
  const subj = subjectText(e, names);
  const p = periodText(e);
  switch (e.kind) {
    case "SPIKE":
    case "DROP": {
      const k = ((e.extra.months as unknown[]) ?? []).length;
      if (k > 1) return `${p}, ${subj} 출고가 ${k}개월 연속 평소보다 ${e.diff > 0 ? "많았습니다" : "적었습니다"} (합계 ${n(e.diff)}개 ${e.diff > 0 ? "더" : "덜"})`;
      return `${p}, ${subj} 출고가 평소보다 ${n(e.diff)}개 ${e.diff > 0 ? "늘었습니다" : "줄었습니다"}`;
    }
    case "STOP": {
      const z = e.extra.zeroMonths as number;
      return e.extra.ongoing
        ? `${ymText(e.periodStart)}부터 ${subj} 출고가 ${z}개월째 없습니다 (평소 월 ${n(e.baseline)}개)`
        : `${p}, ${subj} 출고가 ${z}개월 끊겼습니다 (평소 월 ${n(e.baseline)}개)`;
    }
    case "RESUME":
      return `${p}, ${subj} 출고가 ${e.extra.gapMonths}개월 만에 다시 발생했습니다 (${n(e.actual)}개)`;
    case "TREND_UP":
    case "TREND_DOWN": {
      const q = (e.extra.quarters as unknown[]).length - 1;
      return `${p}, ${subj} 출고가 ${q}분기 연속 ${e.kind === "TREND_UP" ? "늘었습니다" : "줄었습니다"} (3개월 ${n(e.baseline)}개 → ${n(e.actual)}개)`;
    }
    case "SEASON_UP":
    case "SEASON_DOWN": {
      const hits = (e.extra.hitYears as string[]).length;
      return `${subj}는 ${e.extra.comparable}개 해 중 ${hits}개 해 ${e.extra.month}월 출고가 그해 월평균보다 ${e.kind === "SEASON_UP" ? "많았습니다" : "적었습니다"} (평균 ${n(e.diff)}개 차이)`;
    }
  }
}

export type EventDetail = { actual: string[]; baseline: string[]; contributors: string[]; calendar: string[]; checks: string[] };

export function detailOf(e: DetectedEvent, names: Names, opts: { monthEndProducts: Set<string>; relatedStops?: DetectedEvent[] }): EventDetail {
  const p = periodText(e);
  const actual: string[] = [];
  const baseline: string[] = [];
  if (e.kind === "SEASON_UP" || e.kind === "SEASON_DOWN") {
    const ys = e.extra.years as { year: string; value: number; mean: number }[];
    for (const y of ys) actual.push(`${y.year}년 ${e.extra.month}월 ${n(y.value)}개 · 그해 월평균 ${n(y.mean)}개 (${y.mean > 0 ? `${y.value >= y.mean ? "+" : "−"}${Math.round(Math.abs(y.value / y.mean - 1) * 100)}%` : "기준 0"})`);
    baseline.push(`평소 = ${e.baselineDesc}. 그해 월평균보다 20% 이상 ${e.kind === "SEASON_UP" ? "많은" : "적은"} 해가 ${(e.extra.hitYears as string[]).length}개`);
  } else if (e.kind.startsWith("TREND")) {
    for (const q of e.extra.quarters as { from: string; to: string; sum: number }[]) actual.push(`${ymText(q.from)}~${ymText(q.to)}: ${n(q.sum)}개`);
    baseline.push(`평소 = ${e.baselineDesc} ${n(e.baseline)}개`);
  } else if (((e.extra.months as unknown[]) ?? []).length > 1) {
    for (const m of e.extra.months as { ym: string; actual: number; baseline: number; diff: number }[]) actual.push(`${ymText(m.ym)}: 실제 ${n(m.actual)}개 · 평소 ${n(m.baseline)}개 (${signed(m.diff)}개)`);
    baseline.push(`평소 합계: ${n(e.baseline)}개 — 비교 기준: ${e.baselineDesc}`);
  } else {
    actual.push(`실제 수량: ${p} ${n(e.actual)}개`);
    baseline.push(`평소 수량: ${n(e.baseline)}개 — 비교 기준: ${e.baselineDesc}`);
    if (e.spread) baseline.push(`평소 변동 폭: ±${n(e.spread)}개 (차이가 이것의 ${Math.round(Math.abs(e.diff) / e.spread)}배)`);
  }
  if (!e.kind.startsWith("SEASON")) baseline.push(`차이: ${signed(e.diff)}개${e.baseline > 0 && !e.kind.startsWith("STOP") ? ` (${e.diff >= 0 ? "+" : "−"}${Math.round(Math.abs(e.diff / e.baseline) * 100)}%)` : ""}`);

  const contributors = e.contributors.slice(0, 5).map((c) => {
    const who = c.scope === "CUSTOMER" ? `거래처 ${c.key}` : `품목 ${names.product(c.key)}(${c.key})`;
    return `${who}: ${n(c.actual)}개 (평소 ${n(c.baseline)}개, ${signed(c.diff)}개)`;
  });
  if (contributors.length === 0 && (e.scope === "ALL" || e.scope === "CUSTOMER" || e.scope === "PRODUCT") && (e.kind === "SPIKE" || e.kind === "DROP") && e.grain === "MONTH")
    contributors.push("같은 방향으로 움직인 하위 거래처·품목이 없습니다.");
  if (e.grain === "WEEK") contributors.push("주 단위 결과는 거래처·품목 기여를 따로 나누지 않습니다 — 같은 달의 월 단위 결과를 함께 보세요.");
  if (e.contributors.length) {
    const top = e.contributors[0];
    const share = Math.abs(top.diff / e.diff);
    if (share >= 0.5 && e.scope === "ALL") contributors.unshift(`전사 차이의 ${Math.round(share * 100)}%가 ${top.scope === "CUSTOMER" ? `거래처 ${top.key}` : `품목 ${names.product(top.key)}`} 한 곳에 집중`);
  }

  // 관련 일정 (공식 달력) — 사실만
  const calendar: string[] = [];
  const range: [string, string] = e.grain === "WEEK" ? [e.periodStart, e.periodEnd] : [monthRangeOf(e.periodStart)[0], monthRangeOf(e.periodEnd)[1]];
  if (!e.kind.startsWith("SEASON") && calendarCovers(range[0], range[1])) {
    const hs = holidaysIn(range[0], range[1]);
    const bd = businessDays(range[0], range[1]);
    if (e.grain === "WEEK") {
      calendar.push(`이 주 영업일 ${bd}일 (토·일·공휴일 제외, 평소 5일)`);
      const near = holidaysNear(range[0], range[1], 7);
      if (near.length) calendar.push(`앞뒤 1주 안 공휴일: ${near.map((h) => `${md(h.date)} ${h.name}`).join(", ")} — 연휴 전후 주`);
    } else if (e.kind === "SPIKE" || e.kind === "DROP") {
      const base = e.baselinePeriods.filter((m) => /^\d{4}-\d{2}$/.test(m) && calendarCovers(`${m}-01`, `${m}-01`));
      const avg = base.length ? base.reduce((s, m) => s + businessDays(...monthRangeOf(m)), 0) / base.length : null;
      calendar.push(`이 달 영업일 ${bd}일${avg !== null ? ` · 비교 기간 평균 ${avg.toFixed(1)}일 (차이 ${bd - avg >= 0 ? "+" : "−"}${Math.abs(bd - avg).toFixed(1)}일)` : ""}`);
    }
    if (hs.length) calendar.push(`기간 안 공휴일: ${hs.map((h) => `${md(h.date)} ${h.name}`).join(", ")}`);
    if (calendar.length) calendar.push("공휴일·영업일은 날짜가 겹친다는 사실일 뿐 변동의 원인으로 확인된 것은 아닙니다.");
  }

  const checks: string[] = [];
  const meProducts = e.contributors.filter((c) => c.scope === "PRODUCT" && opts.monthEndProducts.has(c.key)).map((c) => c.key);
  if (e.product && opts.monthEndProducts.has(e.product)) meProducts.unshift(e.product);
  if (meProducts.length) checks.push(`월말 일괄 기록 품목 포함(${meProducts.join(", ")}) — 실제 출고 시점과 기록 달이 다를 수 있음`);
  if (e.scope === "CUSTOMER" || e.scope === "PAIR") checks.push(`해당 거래처(${e.customer}) 발주 내역 확인`);
  else if (e.scope === "PRODUCT") checks.push(`해당 품목의 거래처별 발주와 생산·재고 일정 확인`);
  else if (e.contributors.length) checks.push(`기여가 큰 ${e.contributors.find((c) => c.scope === "CUSTOMER") ? `거래처(${e.contributors.find((c) => c.scope === "CUSTOMER")!.key})` : "거래처"} 발주 내역 확인`);
  if (e.kind === "STOP") checks.push(e.extra.ongoing ? "거래 중단·품번 전환 여부 확인" : "끊긴 기간의 발주·품번 전환 여부 확인");
  for (const st of opts.relatedStops ?? [])
    checks.push(`같은 거래처의 ${names.product(st.product!)}(${st.product}) 출고가 ${ymText(st.periodStart)}부터 끊겼습니다 — 품번 전환 여부 확인`);
  checks.push("회사 휴무·판촉·발주 변경 기록이 없어 원인은 판단하지 않았습니다.");
  return { actual, baseline, contributors, calendar, checks };
}
