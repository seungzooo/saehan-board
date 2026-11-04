/**
 * 출고 이력에서 "주목할 날짜와 기간"을 찾는다 — 순수 함수 (테스트 tests/events.test.ts).
 * 입력: 정상 출고 일별 행(출고일·거래처·품번·낱개 수량)과 집계 완료된 달 목록. 출력: 탐지 결과(저장용).
 *
 * 검사 단위
 *   - 월: 전사 / 거래처별 / 품목별 / 거래처×품목별 — 전사 합계에 가려진 변화도 찾는다
 *   - 주(월~일): 전사와 출고량 상위 거래처(월말 일괄 기록 거래처 제외). 월말 일괄 기록 품목은 주 단위로 판정하지 않는다
 *   - 집계 완료된 달만 쓴다. 전사 출고 행이 하나도 없는 완료 달 = 자료 누락 → 검사에서 뺀다(실제 0과 구분)
 *
 * 평소(비교 기준) — 질문마다 다르게
 *   - 유난히 많거나 적은 달(SPIKE/DROP): 과거 같은 달(앞선 해 2개 이상)의 중앙값, 없으면 직전 12개월 중앙값.
 *     평소 변동 폭 = 직전 12개월의 1.4826×MAD(그 기준값의 15% 이상). |차이| ≥ 3×변동 폭 이고 ≥ 기준값의 50%이고 ≥ 실무 최소량일 때만.
 *   - 유난히 많거나 적은 주: 직전 8주 중앙값, 같은 변동 폭 규칙(기준값의 40%).
 *   - 끊김(STOP): 직전 12개월 중 9개월 이상 출고하던 대상이 3개월 이상 연속 0. 간헐 출고 대상(12개월 중 6개월 이하)은 판정하지 않는다.
 *   - 재개(RESUME): 6개월 이상 0이었다가 다시 출고(그 전 12개월 중 6개월 이상 출고했던 대상).
 *   - 추세(TREND): 3개월 묶음(분기)이 3번 연속 10% 이상 늘거나 줄고, 처음→끝 변화가 실무 최소량의 3배 이상.
 *   - 반복(SEASONAL): 같은 달이 그해 월평균보다 20% 이상 많거나(적거나) 비교 가능한 4개 해 이상에서 반복.
 *   - 실무 최소량 = 전사 최근 12개월 월 출고 중앙값의 0.2%(주는 그 1/4) — 1개→3개 같은 작은 변화가 증가율만으로 뜨지 않게.
 * 영향(정렬) = 실제 증감 수량(개)의 절대값. 증가율만으로 정렬하지 않는다.
 */

export type DailyRow = { date: string; customer: string; product: string; units: number };
export type Scope = "ALL" | "CUSTOMER" | "PRODUCT" | "PAIR";
export type EventKind = "SPIKE" | "DROP" | "STOP" | "RESUME" | "TREND_UP" | "TREND_DOWN" | "SEASON_UP" | "SEASON_DOWN";
export type Contributor = { scope: "CUSTOMER" | "PRODUCT"; key: string; actual: number; baseline: number; diff: number };

export type DetectedEvent = {
  id: string;
  kind: EventKind;
  scope: Scope;
  customer: string | null;
  product: string | null;
  grain: "MONTH" | "WEEK";
  /** 기간 (월: YYYY-MM, 주: 그 주 월요일 YYYY-MM-DD) */
  periodStart: string;
  periodEnd: string;
  actual: number;
  baseline: number;
  diff: number;
  /** "과거 같은 달(2022·2023·2024년) 중앙값" 같은 비교 기준 설명 */
  baselineDesc: string;
  baselinePeriods: string[];
  spread: number | null;
  impact: number;
  contributors: Contributor[];
  extra: Record<string, unknown>;
};

const median = (v: number[]) => {
  if (v.length === 0) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (v: number[]) => {
  const m = median(v);
  return 1.4826 * median(v.map((x) => Math.abs(x - m)));
};
const shiftYm = (ym: string, d: number) => {
  const [y, m] = ym.split("-").map(Number);
  const i = y * 12 + m - 1 + d;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};
const DAY = 86400_000;
const mondayOf = (date: string) => {
  const t = Date.parse(`${date}T00:00:00Z`);
  const w = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - w * DAY).toISOString().slice(0, 10);
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export const RULES = {
  spikeSigma: 3,
  spikeRelMonth: 0.5,
  spikeRelWeek: 0.4,
  spreadFloor: 0.15,
  minPriorYears: 2,
  trailing: 12,
  minTrailing: 6,
  weekTrailing: 8,
  regularMonths: 9,
  intermittentMonths: 6,
  stopMonths: 3,
  resumeGap: 6,
  trendStep: 0.1,
  seasonRatio: 0.2,
  seasonYears: 4,
  materialShare: 0.002,
  weekCustomers: 30,
} as const;

type Series = { scope: Scope; customer: string | null; product: string | null; byMonth: Map<string, number> };

export type DetectInput = {
  rows: DailyRow[];
  /** 집계 완료된 달 (오름차순). 자료 범위 밖·집계 중 달은 넣지 않는다 */
  completeMonths: string[];
  /** 월말 일괄 기록 품목 (주 단위 판정 제외) */
  monthEndProducts: Set<string>;
};

export function detectEvents(input: DetectInput): { events: DetectedEvent[]; missingMonths: string[]; materiality: number } {
  const { rows, monthEndProducts } = input;
  // 자료 누락 달(완료 달인데 전사 행 없음)은 뺀다
  const monthsWithRows = new Set(rows.map((r) => r.date.slice(0, 7)));
  const missingMonths = input.completeMonths.filter((m) => !monthsWithRows.has(m));
  const months = input.completeMonths.filter((m) => monthsWithRows.has(m));
  const monthSet = new Set(months);
  if (months.length === 0) return { events: [], missingMonths, materiality: 0 };

  // 월 시리즈: 전사·거래처·품목·거래처×품목
  const series = new Map<string, Series>();
  const get = (scope: Scope, customer: string | null, product: string | null) => {
    const k = `${scope}|${customer ?? ""}|${product ?? ""}`;
    let s = series.get(k);
    if (!s) series.set(k, (s = { scope, customer, product, byMonth: new Map() }));
    return s;
  };
  const add = (s: Series, ym: string, v: number) => s.byMonth.set(ym, (s.byMonth.get(ym) ?? 0) + v);
  for (const r of rows) {
    const ym = r.date.slice(0, 7);
    if (!monthSet.has(ym)) continue;
    add(get("ALL", null, null), ym, r.units);
    add(get("CUSTOMER", r.customer, null), ym, r.units);
    add(get("PRODUCT", null, r.product), ym, r.units);
    add(get("PAIR", r.customer, r.product), ym, r.units);
  }
  const all = get("ALL", null, null);
  const last12 = months.slice(-12).map((m) => all.byMonth.get(m) ?? 0);
  const materiality = Math.max(1, median(last12) * RULES.materialShare);

  const events: DetectedEvent[] = [];
  const val = (s: Series, ym: string) => s.byMonth.get(ym) ?? 0;

  for (const s of series.values()) {
    const xs = months.map((m) => val(s, m));
    const total = xs.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    const label = { scope: s.scope, customer: s.customer, product: s.product };
    const idBase = `${s.scope}|${s.customer ?? ""}|${s.product ?? ""}`;

    // 월별 출고 빈도 (직전 12개월)
    const shippedIn = (i: number, n = RULES.trailing) => xs.slice(Math.max(0, i - n), i).filter((v) => v > 0).length;

    // ── 유난히 많거나 적은 달 ──
    for (let i = RULES.minTrailing; i < months.length; i++) {
      const ym = months[i];
      const prior = shippedIn(i);
      if (prior <= RULES.intermittentMonths && xs[i] === 0) continue; // 간헐 대상의 0은 변동 아님
      if (prior <= RULES.intermittentMonths) continue; // 간헐 대상은 월별 급변 판정 안 함 (연간 합계로 비교)
      const trailing = xs.slice(Math.max(0, i - RULES.trailing), i);
      const sameMonths = months.slice(0, i).filter((m) => m.slice(5) === ym.slice(5));
      let baseline: number;
      let desc: string;
      let periods: string[];
      if (sameMonths.length >= RULES.minPriorYears) {
        baseline = median(sameMonths.map((m) => val(s, m)));
        desc = `과거 같은 달(${sameMonths.map((m) => m.slice(0, 4)).join("·")}년) 중앙값`;
        periods = sameMonths;
      } else {
        baseline = median(trailing);
        desc = `직전 ${trailing.length}개월(${months[Math.max(0, i - RULES.trailing)]}~${months[i - 1]}) 중앙값`;
        periods = months.slice(Math.max(0, i - RULES.trailing), i);
      }
      const spread = Math.max(mad(trailing), baseline * RULES.spreadFloor);
      const diff = xs[i] - baseline;
      if (Math.abs(diff) < RULES.spikeSigma * spread || Math.abs(diff) < baseline * RULES.spikeRelMonth || Math.abs(diff) < materiality) continue;
      events.push({
        id: `${idBase}|M|${ym}`,
        kind: diff > 0 ? "SPIKE" : "DROP",
        ...label,
        grain: "MONTH",
        periodStart: ym,
        periodEnd: ym,
        actual: xs[i],
        baseline,
        diff,
        baselineDesc: desc,
        baselinePeriods: periods,
        spread,
        impact: Math.abs(diff),
        contributors: [],
        extra: {},
      });
    }

    if (s.scope !== "ALL") {
      // ── 끊김 / 재개 ──
      for (let i = RULES.trailing; i < months.length; i++) {
        if (xs[i] !== 0 || xs[i - 1] === 0) continue; // 0이 시작되는 달만
        if (shippedIn(i) < RULES.regularMonths) continue; // 꾸준히 출고되던 대상만
        let j = i;
        while (j < months.length && xs[j] === 0) j++;
        const zeros = j - i;
        if (zeros < RULES.stopMonths) continue;
        const prev = xs.slice(i - RULES.trailing, i);
        const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
        if (avg * zeros < materiality) continue;
        events.push({
          id: `${idBase}|STOP|${months[i]}`,
          kind: "STOP",
          ...label,
          grain: "MONTH",
          periodStart: months[i],
          periodEnd: months[j - 1],
          actual: 0,
          baseline: avg,
          diff: -avg * zeros,
          baselineDesc: `직전 12개월(${months[i - RULES.trailing]}~${months[i - 1]}) 월평균 — 그중 ${shippedIn(i)}개월 출고`,
          baselinePeriods: months.slice(i - RULES.trailing, i),
          spread: null,
          impact: avg, // 월 단위 감소 폭 — 끊긴 기간이 길다고 다른 변화보다 위로 가지 않게
          contributors: [],
          extra: { zeroMonths: zeros, ongoing: j === months.length },
        });
      }
      for (let i = RULES.resumeGap; i < months.length; i++) {
        if (xs[i] <= 0) continue;
        let g = 0;
        while (i - 1 - g >= 0 && xs[i - 1 - g] === 0) g++;
        if (g < RULES.resumeGap) continue;
        const before = xs.slice(Math.max(0, i - g - RULES.trailing), i - g);
        if (before.filter((v) => v > 0).length < RULES.intermittentMonths) continue;
        if (xs[i] < materiality) continue;
        events.push({
          id: `${idBase}|RESUME|${months[i]}`,
          kind: "RESUME",
          ...label,
          grain: "MONTH",
          periodStart: months[i],
          periodEnd: months[i],
          actual: xs[i],
          baseline: 0,
          diff: xs[i],
          baselineDesc: `직전 ${g}개월 출고 없음 (${months[i - g]}~${months[i - 1]})`,
          baselinePeriods: months.slice(i - g, i),
          spread: null,
          impact: xs[i],
          contributors: [],
          extra: { gapMonths: g },
        });
      }
    }

    // ── 추세: 분기(3개월) 묶음이 3번 연속 10% 이상 같은 방향 ──
    const q: { from: string; to: string; sum: number }[] = [];
    for (let e = months.length; e - 3 >= 0; e -= 3) q.unshift({ from: months[e - 3], to: months[e - 1], sum: xs.slice(e - 3, e).reduce((a, b) => a + b, 0) });
    const regularNow = shippedIn(months.length) > RULES.intermittentMonths;
    if (regularNow || s.scope === "ALL") {
      let k = 0;
      while (k + 3 < q.length) {
        const w = q.slice(k, k + 4);
        const up = w.every((b, n) => n === 0 || (w[n - 1].sum > 0 && b.sum >= w[n - 1].sum * (1 + RULES.trendStep)));
        const down = w.every((b, n) => n === 0 || (w[n - 1].sum > 0 && b.sum <= w[n - 1].sum * (1 - RULES.trendStep)));
        const change = w[3].sum - w[0].sum;
        if ((up || down) && Math.abs(change) >= materiality * 3) {
          // 같은 방향이 더 이어지면 늘려 잡는다
          let end = k + 3;
          while (end + 1 < q.length && (up ? q[end + 1].sum >= q[end].sum * (1 + RULES.trendStep) : q[end + 1].sum <= q[end].sum * (1 - RULES.trendStep))) end++;
          const blocks = q.slice(k, end + 1);
          const ch = blocks.at(-1)!.sum - blocks[0].sum;
          events.push({
            id: `${idBase}|TREND|${blocks[0].from}`,
            kind: up ? "TREND_UP" : "TREND_DOWN",
            ...label,
            grain: "MONTH",
            periodStart: blocks[0].from,
            periodEnd: blocks.at(-1)!.to,
            actual: blocks.at(-1)!.sum,
            baseline: blocks[0].sum,
            diff: ch,
            baselineDesc: `처음 3개월(${blocks[0].from}~${blocks[0].to}) 합계`,
            baselinePeriods: [blocks[0].from, blocks[0].to],
            spread: null,
            impact: Math.abs(ch),
            contributors: [],
            extra: { quarters: blocks.map((b) => ({ from: b.from, to: b.to, sum: b.sum })) },
          });
          k = end;
        } else k++;
      }
    }

    // ── 여러 해 같은 달 반복 ──
    if (s.scope !== "PAIR") {
      const years = [...new Set(months.map((m) => m.slice(0, 4)))];
      const fullYears = years.filter((y) => months.filter((m) => m.startsWith(y)).length === 12);
      const yearMean = new Map(fullYears.map((y) => [y, months.filter((m) => m.startsWith(y)).reduce((a, m) => a + val(s, m), 0) / 12]));
      const comparable = fullYears.filter((y) => (yearMean.get(y) ?? 0) > 0);
      if (comparable.length >= RULES.seasonYears && shippedIn(months.length) > RULES.intermittentMonths) {
        for (let mo = 1; mo <= 12; mo++) {
          const mm = String(mo).padStart(2, "0");
          const ratios = comparable.map((y) => ({ y, v: val(s, `${y}-${mm}`), mean: yearMean.get(y)! }));
          const upY = ratios.filter((r) => r.v > r.mean * (1 + RULES.seasonRatio));
          const downY = ratios.filter((r) => r.v < r.mean * (1 - RULES.seasonRatio));
          for (const [hits, kind] of [
            [upY, "SEASON_UP"],
            [downY, "SEASON_DOWN"],
          ] as const) {
            if (hits.length < RULES.seasonYears) continue;
            const avgDiff = hits.reduce((a, r) => a + (r.v - r.mean), 0) / hits.length;
            if (Math.abs(avgDiff) < materiality) continue;
            const actual = hits.reduce((a, r) => a + r.v, 0) / hits.length;
            events.push({
              id: `${idBase}|${kind}|${mm}`,
              kind,
              ...label,
              grain: "MONTH",
              periodStart: `${hits[0].y}-${mm}`,
              periodEnd: `${hits.at(-1)!.y}-${mm}`,
              actual,
              baseline: actual - avgDiff,
              diff: avgDiff,
              baselineDesc: `각 해의 월평균 (비교 가능한 ${comparable.length}개 해: ${comparable.join("·")}년)`,
              baselinePeriods: comparable,
              spread: null,
              impact: Math.abs(avgDiff),
              contributors: [],
              extra: { month: mo, years: ratios.map((r) => ({ year: r.y, value: r.v, mean: r.mean })), hitYears: hits.map((r) => r.y), comparable: comparable.length },
            });
          }
        }
      }
    }
  }

  // ── 주 단위: 전사 + 출고량 상위 거래처(월말 일괄 기록 거래처 제외), 월말 일괄 기록 품목은 빼고 합산 ──
  const firstDay = `${months[0]}-01`;
  const lastYm = months.at(-1)!;
  const [ly, lm] = lastYm.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ly, lm, 0)).toISOString().slice(0, 10);
  const custTotal = new Map<string, number>();
  const custMonthEnd = new Map<string, { n: number; me: number }>();
  for (const r of rows) {
    custTotal.set(r.customer, (custTotal.get(r.customer) ?? 0) + r.units);
    const c = custMonthEnd.get(r.customer) ?? { n: 0, me: 0 };
    c.n++;
    if (addDays(r.date, 1).slice(8) === "01") c.me++;
    custMonthEnd.set(r.customer, c);
  }
  const weekCust = [...custTotal.entries()]
    .filter(([c]) => {
      const m = custMonthEnd.get(c)!;
      return m.me / m.n < 0.8;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, RULES.weekCustomers)
    .map(([c]) => c);
  const weekSeries = new Map<string, Map<string, number>>(); // key: "" = 전사, 그 밖 = 거래처
  for (const r of rows) {
    // 월말 일괄 기록 품목과 월말 날짜 기록은 주 단위에서 뺀다 — 한 달 치를 말일에 몰아 적은 기록이 '그 주 급증'으로 보이지 않게
    if (r.date < firstDay || r.date > lastDay || monthEndProducts.has(r.product) || addDays(r.date, 1).slice(8) === "01" || !monthSet.has(r.date.slice(0, 7))) continue;
    const wk = mondayOf(r.date);
    for (const key of ["", ...(weekCust.includes(r.customer) ? [r.customer] : [])]) {
      let m = weekSeries.get(key);
      if (!m) weekSeries.set(key, (m = new Map()));
      m.set(wk, (m.get(wk) ?? 0) + r.units);
    }
  }
  // 완전한 주만 (월요일~일요일이 모두 자료 범위·완료 달 안)
  const weeks: string[] = [];
  for (let w = mondayOf(firstDay); w <= lastDay; w = addDays(w, 7)) {
    if (w >= firstDay && addDays(w, 6) <= lastDay && monthSet.has(w.slice(0, 7)) && monthSet.has(addDays(w, 6).slice(0, 7))) weeks.push(w);
  }
  const weekMaterial = materiality / 4;
  for (const [key, m] of weekSeries) {
    const xs = weeks.map((w) => m.get(w) ?? 0);
    for (let i = RULES.weekTrailing; i < weeks.length; i++) {
      const trailing = xs.slice(i - RULES.weekTrailing, i);
      if (trailing.filter((v) => v > 0).length < RULES.weekTrailing - 2) continue; // 꾸준히 출고되는 대상만
      const baseline = median(trailing);
      const spread = Math.max(mad(trailing), baseline * RULES.spreadFloor);
      const diff = xs[i] - baseline;
      if (Math.abs(diff) < RULES.spikeSigma * spread || Math.abs(diff) < baseline * RULES.spikeRelWeek || Math.abs(diff) < weekMaterial) continue;
      events.push({
        id: `${key ? "CUSTOMER" : "ALL"}|${key}||W|${weeks[i]}`,
        kind: diff > 0 ? "SPIKE" : "DROP",
        scope: key ? "CUSTOMER" : "ALL",
        customer: key || null,
        product: null,
        grain: "WEEK",
        periodStart: weeks[i],
        periodEnd: addDays(weeks[i], 6),
        actual: xs[i],
        baseline,
        diff,
        baselineDesc: `직전 8주(${weeks[i - RULES.weekTrailing]}~${addDays(weeks[i - 1], 6)}) 중앙값`,
        baselinePeriods: weeks.slice(i - RULES.weekTrailing, i),
        spread,
        impact: Math.abs(diff),
        contributors: [],
        extra: { excludedMonthEndProducts: monthEndProducts.size },
      });
    }
  }

  // ── 기여: 차이를 만든 거래처·품목 (같은 기간·같은 기준 방식으로 각자의 평소와 비교) ──
  const custSeries = [...series.values()].filter((s) => s.scope === "CUSTOMER");
  const prodSeries = [...series.values()].filter((s) => s.scope === "PRODUCT");
  const pairSeries = [...series.values()].filter((s) => s.scope === "PAIR");
  for (const e of events) {
    if (e.grain !== "MONTH" || e.scope === "PAIR" || !["SPIKE", "DROP", "TREND_UP", "TREND_DOWN"].includes(e.kind)) continue;
    const pool =
      e.scope === "ALL"
        ? [...custSeries, ...prodSeries]
        : e.scope === "CUSTOMER"
          ? pairSeries.filter((p) => p.customer === e.customer)
          : pairSeries.filter((p) => p.product === e.product);
    const periodMonths = months.filter((m) => m >= e.periodStart && m <= e.periodEnd);
    const contrib = pool.map((s) => {
      let actual: number, baseline: number;
      if (e.kind.startsWith("TREND")) {
        const q = (e.extra.quarters as { from: string; to: string }[]) ?? [];
        const sumR = (a: string, b: string) => months.filter((m) => m >= a && m <= b).reduce((t, m) => t + val(s, m), 0);
        actual = q.length ? sumR(q.at(-1)!.from, q.at(-1)!.to) : 0;
        baseline = q.length ? sumR(q[0].from, q[0].to) : 0;
      } else {
        actual = periodMonths.reduce((t, m) => t + val(s, m), 0);
        baseline = median(e.baselinePeriods.map((m) => val(s, m)));
      }
      const scope = s.scope === "CUSTOMER" || (s.scope === "PAIR" && e.scope === "PRODUCT") ? ("CUSTOMER" as const) : ("PRODUCT" as const);
      const key = scope === "CUSTOMER" ? s.customer! : s.product!;
      return { scope, key, actual, baseline, diff: actual - baseline };
    });
    const sign = Math.sign(e.diff);
    e.contributors = contrib
      .filter((c) => Math.sign(c.diff) === sign && c.diff !== 0)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
      .slice(0, 6);
  }

  // 같은 대상이 연속된 달에 같은 방향으로 계속 많거나 적으면 한 건으로 (예: 1~7월 계속 평소보다 많음)
  const merged: DetectedEvent[] = [];
  const keyOf = (e: DetectedEvent) => `${e.scope}|${e.customer ?? ""}|${e.product ?? ""}|${e.kind}`;
  const monthly = events.filter((e) => e.grain === "MONTH" && (e.kind === "SPIKE" || e.kind === "DROP")).sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.periodStart.localeCompare(b.periodStart));
  for (const e of monthly) {
    const prev = merged.at(-1);
    if (prev && keyOf(prev) === keyOf(e) && shiftYm(prev.periodEnd, 1) === e.periodStart) {
      const months = (prev.extra.months as { ym: string; actual: number; baseline: number; diff: number }[]) ?? [];
      months.push({ ym: e.periodStart, actual: e.actual, baseline: e.baseline, diff: e.diff });
      prev.extra.months = months;
      prev.periodEnd = e.periodEnd;
      prev.actual += e.actual;
      prev.baseline += e.baseline;
      prev.diff += e.diff;
      prev.impact = Math.abs(prev.diff);
      prev.baselinePeriods = [...new Set([...prev.baselinePeriods, ...e.baselinePeriods])];
      prev.baselineDesc = `달마다 ${e.baselineDesc.replace(/\(.*\)/, "").trim()}의 합`;
      const byKey = new Map(prev.contributors.map((c) => [`${c.scope}|${c.key}`, { ...c }]));
      for (const c of e.contributors) {
        const k = `${c.scope}|${c.key}`;
        const cur = byKey.get(k);
        if (cur) {
          cur.actual += c.actual;
          cur.baseline += c.baseline;
          cur.diff += c.diff;
        } else byKey.set(k, { ...c });
      }
      prev.contributors = [...byKey.values()].sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff)).slice(0, 6);
    } else {
      e.extra = { ...e.extra, months: [{ ym: e.periodStart, actual: e.actual, baseline: e.baseline, diff: e.diff }] };
      merged.push(e);
    }
  }
  for (const e of merged) if (e.periodStart !== e.periodEnd) e.id = `${e.id}~${e.periodEnd}`;
  events.splice(0, events.length, ...events.filter((e) => !(e.grain === "MONTH" && (e.kind === "SPIKE" || e.kind === "DROP"))), ...merged);

  // 끊김이 시작된 달의 같은 대상 DROP은 끊김으로 합친다
  const stopKeys = new Set(events.filter((e) => e.kind === "STOP").map((e) => `${e.scope}|${e.customer}|${e.product}|${e.periodStart}`));
  return {
    events: events.filter((e) => !(e.kind === "DROP" && e.grain === "MONTH" && stopKeys.has(`${e.scope}|${e.customer}|${e.product}|${e.periodStart}`))),
    missingMonths,
    materiality,
  };
}

/**
 * 같은 사건 묶기: 같은 기간·같은 방향의 월 단위 급변 중 전사·거래처·품목·거래처×품목이 서로 기여 관계면 한 건.
 * 대표 = 가장 구체적인 대상 중 묶음에서 가장 큰 차이의 50% 이상을 설명하는 것.
 */
export type EventGroup = { key: string; lead: DetectedEvent; members: DetectedEvent[] };
export function groupEvents(events: DetectedEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  const specificity: Record<Scope, number> = { ALL: 0, CUSTOMER: 1, PRODUCT: 1, PAIR: 2 };
  const sorted = [...events].sort((a, b) => b.impact - a.impact);
  const family = (k: DetectedEvent["kind"]) => (k === "SPIKE" || k === "DROP" ? "JUMP" : k.startsWith("TREND") ? "TREND" : k.startsWith("SEASON") ? `SEASON` : k);
  const related = (g: EventGroup, e: DetectedEvent) => {
    if (g.lead.grain !== e.grain || Math.sign(g.lead.diff) !== Math.sign(e.diff)) return false;
    if (!g.members.every((m) => family(m.kind) === family(e.kind))) return false;
    // 같은 기간(급변은 기간이 겹치면 같은 사건으로 본다) — 기간과 관계가 같은 구성원 하나에서 함께 성립해야 한다
    const overlaps = (m: DetectedEvent) => (family(e.kind) === "JUMP" ? m.periodStart <= e.periodEnd && e.periodStart <= m.periodEnd : m.periodStart === e.periodStart);
    return g.members.some((m) => {
      if (!overlaps(m)) return false;
      const mc = m.customer, mp = m.product;
      if (m.scope === "ALL" || e.scope === "ALL") {
        // 전사 변화는 가장 크게 기여한 거래처·품목 하나와만 묶는다 (다른 기여자의 변화는 별도 건으로 남김)
        const all = m.scope === "ALL" ? m : e;
        const top = [all.contributors.find((c) => c.scope === "CUSTOMER"), all.contributors.find((c) => c.scope === "PRODUCT")]
          .filter((c): c is Contributor => !!c)
          .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
          .slice(0, 1);
        const other = m.scope === "ALL" ? e : m;
        if (other.scope === "ALL") return true;
        // 전사는 기여 상위 거래처·품목 자체와만 (그 거래처의 다른 품목 조합은 각자의 거래처·품목을 거쳐서만)
        return top.some((c) => (other.scope === "CUSTOMER" && c.scope === "CUSTOMER" && c.key === other.customer) || (other.scope === "PRODUCT" && c.scope === "PRODUCT" && c.key === other.product));
      }
      // 거래처×품목은 자기 거래처·자기 품목과만 같은 사건 (같은 거래처의 다른 품목은 별개)
      const pairOf = (p: DetectedEvent, q: DetectedEvent) =>
        p.scope === "PAIR" && ((q.scope === "CUSTOMER" && q.customer === p.customer) || (q.scope === "PRODUCT" && q.product === p.product));
      void mc;
      void mp;
      return pairOf(m, e) || pairOf(e, m) || (m.scope === e.scope && m.customer === e.customer && m.product === e.product);
    });
  };
  for (const e of sorted) {
    const g = groups.find((x) => related(x, e));
    if (g) g.members.push(e);
    else groups.push({ key: e.id, lead: e, members: [e] });
  }
  for (const g of groups) {
    const big = Math.max(...g.members.map((m) => m.impact));
    const cand = g.members.filter((m) => m.impact >= big * 0.5).sort((a, b) => specificity[b.scope] - specificity[a.scope] || b.impact - a.impact);
    g.lead = cand[0];
    g.key = g.lead.id;
  }
  return groups.sort((a, b) => b.lead.impact - a.lead.impact);
}
