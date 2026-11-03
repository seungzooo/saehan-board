/**
 * F5 분석 — 순수 계산 (DB 없음). 테스트: tests/seasonal.test.ts
 *
 * - 월 시계열: 연월 → 값. 빠진 달은 0.
 * - 계절지수(월 m) = 해당 월 평균 출고 ÷ 연평균 월 출고 (기간 내 전체 월 평균).
 * - 시차 상관: corr(생산[t], 출고[t+k]), k = 0..3. 피어슨.
 */

export type MonthValue = { yearMonth: string; value: number };

/** "2021-01" ~ "2025-12" 사이 모든 연월 (양끝 포함) */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** 연월 키 집합에 맞춰 0으로 채운 값 배열 */
export function fillSeries(months: string[], values: Map<string, number>): number[] {
  return months.map((ym) => values.get(ym) ?? 0);
}

export type SeasonalRow = { month: number; index: number | null; avg: number };

/**
 * 계절지수. months·values는 같은 길이. 전체 평균이 0이면 index=null.
 * 각 월의 평균은 그 달이 기간에 등장한 횟수로 나눈다 (5개년이면 5).
 */
export function seasonalIndex(months: string[], values: number[]): SeasonalRow[] {
  const sum = new Array(12).fill(0);
  const cnt = new Array(12).fill(0);
  for (let i = 0; i < months.length; i++) {
    const m = Number(months[i].slice(5, 7)) - 1;
    sum[m] += values[i];
    cnt[m]++;
  }
  const overall = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return sum.map((s, i) => {
    const avg = cnt[i] ? s / cnt[i] : 0;
    return { month: i + 1, avg, index: overall > 0 && cnt[i] ? avg / overall : null };
  });
}

/** 피어슨 상관계수. 길이 < 3 이거나 분산 0이면 null */
export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return null;
  return cov / Math.sqrt(vx * vy);
}

export type LagRow = { lag: number; r: number | null; n: number };

/** corr(생산[t], 출고[t+lag]) for lag = 0..maxLag */
export function lagCorrelations(production: number[], shipment: number[], maxLag = 3): LagRow[] {
  const rows: LagRow[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const x = production.slice(0, production.length - lag);
    const y = shipment.slice(lag);
    rows.push({ lag, r: pearson(x, y), n: Math.min(x.length, y.length) });
  }
  return rows;
}

/** 가장 높은 상관의 시차 (null 제외). 없으면 null */
export function bestLag(rows: LagRow[]): LagRow | null {
  let best: LagRow | null = null;
  for (const r of rows) if (r.r !== null && (best === null || r.r > (best.r as number))) best = r;
  return best;
}

export const PEAK_INDEX = 1.2;
export const LOW_INDEX = 0.8;

/** "7~8월 출고가 평균보다 30% 많음" — 성수기(≥1.2) 달이 연속이면 범위로 묶는다 */
export function describeSeason(rows: SeasonalRow[]): string {
  const valid = rows.filter((r) => r.index !== null);
  if (valid.length === 0) return "출고 이력이 없어 계절 패턴을 산정할 수 없습니다.";
  const peaks = valid.filter((r) => (r.index as number) >= PEAK_INDEX);
  if (peaks.length === 0) {
    const top = valid.reduce((a, b) => ((b.index as number) > (a.index as number) ? b : a));
    return `뚜렷한 성수기 없음 — 가장 많은 ${top.month}월도 평균의 ${pct(top.index as number)} 수준입니다.`;
  }
  const groups = groupConsecutive(peaks.map((p) => p.month));
  const avgIdx = peaks.reduce((s, p) => s + (p.index as number), 0) / peaks.length;
  const label = groups.map((g) => (g.length === 1 ? `${g[0]}월` : `${g[0]}~${g[g.length - 1]}월`)).join(", ");
  return `${label} 출고가 평균보다 ${Math.round((avgIdx - 1) * 100)}% 많음`;
}

/** 현재 달의 지수로 재고 판단 한 줄 */
export function describeNow(index: number | null, month: number, days: number | null): string {
  if (index === null) return `${month}월 계절지수 산정 불가 — 출고 이력이 부족합니다.`;
  const idx = index.toFixed(2);
  const d = days === null ? "" : ` (현재 예상 소진 ${days >= 10 ? Math.round(days) : days.toFixed(1)}일)`;
  if (index >= PEAK_INDEX) return `지금은 성수기(${month}월 지수 ${idx}) → 소진이 평소보다 빨라질 수 있음${d}`;
  if (index <= LOW_INDEX) return `지금은 비수기(${month}월 지수 ${idx}) → 소진이 평소보다 느릴 수 있음${d}`;
  return `지금은 평균 수준(${month}월 지수 ${idx})${d}`;
}

/** "생산 후 1개월 뒤 출고 경향 (r=0.62)" */
export function describeLag(best: LagRow | null): string {
  if (!best || best.r === null) return "생산·출고 상관을 산정할 수 없습니다 (변동이 없거나 기간이 짧음).";
  const strength = best.r >= 0.7 ? "강함" : best.r >= 0.4 ? "보통" : best.r >= 0.2 ? "약함" : "거의 없음";
  const when = best.lag === 0 ? "동월 생산량과 정상 출고량의 상관계수가 가장 높음" : `생산량과 ${best.lag}개월 뒤 정상 출고량의 상관계수가 가장 높음`;
  return `${when} (r=${best.r.toFixed(2)}, 상관 ${strength})`;
}

/** 선 2개 추이 한 줄: 최근 12개월 vs 직전 12개월 출고 증감 */
export function describeTrend(shipments: number[]): string {
  if (shipments.length < 24) return "비교할 기간이 짧습니다.";
  const last = shipments.slice(-12).reduce((a, b) => a + b, 0);
  const prev = shipments.slice(-24, -12).reduce((a, b) => a + b, 0);
  if (prev === 0) return last === 0 ? "최근 2년 출고 없음" : "직전 12개월 출고가 없어 증감을 비교할 수 없습니다.";
  const ch = (last - prev) / prev;
  if (Math.abs(ch) < 0.05) return "최근 12개월 출고는 직전 12개월과 비슷합니다.";
  return `최근 12개월 출고가 직전 12개월보다 ${Math.round(Math.abs(ch) * 100)}% ${ch > 0 ? "많음" : "적음"}`;
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

function groupConsecutive(months: number[]): number[][] {
  const sorted = [...months].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const m of sorted) {
    const g = groups[groups.length - 1];
    if (g && m === g[g.length - 1] + 1) g.push(m);
    else groups.push([m]);
  }
  // 12월·1월이 이어지면 합친다 (예: 12~2월)
  if (groups.length > 1 && groups[0][0] === 1 && groups[groups.length - 1].at(-1) === 12) {
    const last = groups.pop()!;
    groups[0] = [...last, ...groups[0]];
  }
  return groups;
}

// ───────────────────────── 결측월 처리 · 달력 기준 시차 · 연도별 계절지수 ─────────────────────────
//
// 결측월 규칙
//  - 자료 범위(coverage) = 그 실적(생산 또는 출고) 전체 데이터의 첫 달 ~ 마지막 달.
//  - 범위 안인데 그 품목 행이 없는 달 = 실제 0 (ERP 추출은 그 기간 전 품목을 담고 있으므로).
//  - 범위 밖의 달 = 자료 없음(null). 계산에서 제외하고 화면에 "자료 없음"으로 구분한다.

export type Coverage = { from: string; to: string } | null;

/** 달력 순서 months에 대해: 범위 안이면 값(없으면 0), 범위 밖이면 null */
export function coveredSeries(months: string[], values: Map<string, number>, coverage: Coverage): (number | null)[] {
  return months.map((ym) => (coverage && ym >= coverage.from && ym <= coverage.to ? (values.get(ym) ?? 0) : null));
}

/**
 * 생산월 t 와 출고월 t+k 의 상관, k = 0..maxLag (달력 기준).
 * 쌍은 생산[t]와 출고[t+k]가 둘 다 자료 범위 안일 때만 센다 — n = 유효 월 쌍 수.
 * 쌍이 3개 미만이거나 한쪽 분산이 0이면 r = null (0으로 바꾸지 않는다).
 */
export function lagCorrelationsCalendar(production: (number | null)[], shipment: (number | null)[], maxLag = 6): LagRow[] {
  const rows: LagRow[] = [];
  for (let lag = 0; lag <= maxLag; lag++) {
    const x: number[] = [];
    const y: number[] = [];
    for (let t = 0; t + lag < Math.min(production.length, shipment.length); t++) {
      const p = production[t];
      const s = shipment[t + lag];
      if (p === null || s === null) continue;
      x.push(p);
      y.push(s);
    }
    rows.push({ lag, r: pearson(x, y), n: x.length });
  }
  return rows;
}

export type YearCell = { month: number; value: number | null; index: number | null };
export type YearRow = {
  year: number;
  /** 자료 범위 안의 달 수 (12 미만이면 부분 연도) */
  covered: number;
  /** 해당 연도 월평균 정상 출고 = 범위 안 달들의 평균. 범위 안 달이 없으면 null */
  mean: number | null;
  /** ok | zero(연 출고 0 → 지수 산정 불가) | nodata(그 해 자료 없음) */
  status: "ok" | "zero" | "nodata";
  cells: YearCell[];
};

/**
 * 연도별 계절지수: 해당 월 정상 출고량 ÷ 해당 연도 월평균 정상 출고량 (기준값 1).
 * 월평균은 그 해 자료 범위 안의 달만으로 낸다 (부분 연도면 12로 나누지 않는다).
 * 자료 없음(null) 달은 index = null. 연 출고 0이면 모든 달 index = null (status=zero).
 */
export function yearlySeasonal(months: string[], values: (number | null)[]): YearRow[] {
  const byYear = new Map<number, YearCell[]>();
  months.forEach((ym, i) => {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(5, 7));
    if (!byYear.has(y)) byYear.set(y, Array.from({ length: 12 }, (_, k) => ({ month: k + 1, value: null, index: null })));
    byYear.get(y)![m - 1].value = values[i];
  });
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, cells]) => {
      const known = cells.filter((c) => c.value !== null);
      if (known.length === 0) return { year, covered: 0, mean: null, status: "nodata" as const, cells };
      const mean = known.reduce((s, c) => s + (c.value as number), 0) / known.length;
      if (mean === 0) return { year, covered: known.length, mean, status: "zero" as const, cells };
      return {
        year,
        covered: known.length,
        mean,
        status: "ok" as const,
        cells: cells.map((c) => ({ ...c, index: c.value === null ? null : c.value / mean })),
      };
    });
}

/** "생산월 t → 출고월 t+2 상관이 가장 높음 (r=0.71, 유효 57쌍)" */
export function describeLagCalendar(best: LagRow | null): string {
  if (!best || best.r === null) return "생산·출고 상관을 산정할 수 없습니다 (유효 월 쌍이 3개 미만이거나 변동이 없음).";
  const strength = best.r >= 0.7 ? "강함" : best.r >= 0.4 ? "보통" : best.r >= 0.2 ? "약함" : "거의 없음";
  const when = best.lag === 0 ? "생산한 달에 바로 출고되는 경향" : `생산 후 ${best.lag}개월 뒤 출고 경향`;
  return `${when} — 생산월 t ↔ 출고월 t+${best.lag} (r=${best.r.toFixed(2)}, 상관 ${strength}, 유효 ${best.n}쌍)`;
}

/** 연도별 지수 한 줄: 해마다 반복되는 성수기 달이 있는지 */
export function describeYearly(rows: YearRow[], peak = PEAK_INDEX): string {
  const valid = rows.filter((r) => r.status === "ok");
  if (valid.length === 0) return "연도별 지수를 낼 수 있는 해가 없습니다 (자료 없음 또는 연 출고 0).";
  let bestMonth = 0;
  let bestCount = 0;
  for (let m = 1; m <= 12; m++) {
    const c = valid.filter((r) => (r.cells[m - 1].index ?? 0) >= peak).length;
    if (c > bestCount) {
      bestCount = c;
      bestMonth = m;
    }
  }
  if (bestCount <= 1) return `${valid.length}개 해 중 같은 달이 두 번 이상 성수기(지수 ${peak} 이상)인 경우가 없음 — 해마다 성수기가 달라 계절 패턴이 일정하지 않습니다.`;
  return `${bestMonth}월은 ${valid.length}개 해 중 ${bestCount}개 해에서 성수기(지수 ${peak} 이상) — 해마다 반복되는 패턴입니다.`;
}
