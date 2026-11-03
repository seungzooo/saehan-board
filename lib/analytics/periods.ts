/**
 * 월별 출고 기간·비교 — 순수 함수 (DB 없음, 클라이언트에서도 쓴다). 테스트: tests/periods.test.ts
 *
 * 월 상태
 *   ok         자료 범위 안이고 집계 완료. 값이 없으면 실제 0.
 *   missing    자료 범위 안인데 그 달 출고 행이 하나도 없음(전 품목·전 출고구분) → 자료 누락
 *   incomplete 자료는 있으나 집계 완료로 확인되지 않은 마지막 달
 *   nodata     자료 범위 밖
 */

export type MonthStatus = "ok" | "missing" | "incomplete" | "nodata";

export type PeriodContext = {
  /** 자료가 있는 첫 달 · 마지막 달 (전 품목·전 출고구분 기준) */
  firstYm: string | null;
  lastYm: string | null;
  /** 집계 완료로 볼 마지막 달 */
  completeThrough: string | null;
  /** 출고 행이 하나라도 있는 달 */
  present: Set<string>;
};

export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

export const ymOf = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/**
 * 집계 완료 마지막 달. 마지막 자료 달보다 앞선 달은 완료(자료가 그 뒤로 이어짐).
 * 마지막 달은 declaredThrough(원본 보고서 기간 등으로 확인한 값)가 그 달 이상일 때만 완료.
 */
export function buildContext(presentMonths: string[], declaredThrough: string | null): PeriodContext {
  const present = new Set(presentMonths);
  const sorted = [...present].sort();
  const firstYm = sorted[0] ?? null;
  const lastYm = sorted.at(-1) ?? null;
  let completeThrough: string | null = null;
  if (lastYm) {
    if (declaredThrough && declaredThrough >= lastYm) completeThrough = lastYm;
    else if (firstYm && lastYm > firstYm) completeThrough = shiftYm(lastYm, -1);
  }
  return { firstYm, lastYm, completeThrough, present };
}

export function monthStatus(ym: string, ctx: PeriodContext): MonthStatus {
  if (!ctx.firstYm || !ctx.lastYm || ym < ctx.firstYm || ym > ctx.lastYm) return "nodata";
  if (!ctx.completeThrough || ym > ctx.completeThrough) return "incomplete";
  if (!ctx.present.has(ym)) return "missing";
  return "ok";
}

/** 자료가 있는 연도 (오름차순) */
export function yearsOf(ctx: PeriodContext): number[] {
  if (!ctx.firstYm || !ctx.lastYm) return [];
  const out: number[] = [];
  for (let y = Number(ctx.firstYm.slice(0, 4)); y <= Number(ctx.lastYm.slice(0, 4)); y++) out.push(y);
  return out;
}

export type MonthPoint = { month: number; ym: string; units: number | null; status: MonthStatus };

/** 선택 연도 1~12월. 집계 완료 달만 값(없으면 0), 그 밖은 null → 선을 끊는다 */
export function yearSeries(year: number, totals: Map<string, number>, ctx: PeriodContext): MonthPoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const ym = ymOf(year, i + 1);
    const status = monthStatus(ym, ctx);
    return { month: i + 1, ym, units: status === "ok" ? (totals.get(ym) ?? 0) : null, status };
  });
}

/** 전체 기간: 자료 첫 달 ~ 마지막 달 */
export function allSeries(totals: Map<string, number>, ctx: PeriodContext): MonthPoint[] {
  if (!ctx.firstYm || !ctx.lastYm) return [];
  const out: MonthPoint[] = [];
  for (let ym = ctx.firstYm; ym <= ctx.lastYm; ym = shiftYm(ym, 1)) {
    const status = monthStatus(ym, ctx);
    out.push({ month: Number(ym.slice(5)), ym, units: status === "ok" ? (totals.get(ym) ?? 0) : null, status });
  }
  return out;
}

/** 선택 연도에서 집계 완료된 첫 달·마지막 달 (예: 1~9월). 하나도 없으면 null */
export function yearSpan(year: number, ctx: PeriodContext): { from: number; to: number } | null {
  const ok = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => monthStatus(ymOf(year, m), ctx) === "ok");
  return ok.length ? { from: ok[0], to: ok[ok.length - 1] } : null;
}

export const monthSpanLabel = (year: number, from: number, to: number) => (from === to ? `${year}년 ${from}월` : `${year}년 ${from}~${to}월`);
export const ymSpanLabel = (from: string, to: string) => (from === to ? from : `${from}~${to}`);

export type Side = { label: string; from: string; to: string; sum: number };
export type Comparison =
  | { status: "ok"; a: Side; b: Side; pct: number; basis: "yoy" | "rolling12" }
  | { status: "prevZero"; a: Side; b: Side; basis: "yoy" | "rolling12" }
  | { status: "insufficient"; reason: string; basis: "yoy" | "rolling12"; a?: Side; b?: Side };

function sumRange(totals: Map<string, number>, from: string, to: string): number {
  let s = 0;
  for (let ym = from; ym <= to; ym = shiftYm(ym, 1)) s += totals.get(ym) ?? 0;
  return s;
}

function allOk(from: string, to: string, ctx: PeriodContext): MonthStatus | null {
  for (let ym = from; ym <= to; ym = shiftYm(ym, 1)) {
    const st = monthStatus(ym, ctx);
    if (st !== "ok") return st;
  }
  return null;
}

const WHY: Record<Exclude<MonthStatus, "ok">, string> = {
  nodata: "비교할 기간의 자료가 없음",
  missing: "기간 안에 자료가 누락된 달이 있음",
  incomplete: "집계가 끝나지 않은 달이 포함됨",
};

function finish(basis: "yoy" | "rolling12", a: Side, b: Side, ctx: PeriodContext): Comparison {
  const badA = allOk(a.from, a.to, ctx);
  const badB = allOk(b.from, b.to, ctx);
  if (badA || badB) return { status: "insufficient", reason: WHY[(badA ?? badB) as Exclude<MonthStatus, "ok">], basis, a, b };
  if (b.sum === 0) return { status: "prevZero", a, b, basis };
  return { status: "ok", a, b, pct: ((a.sum - b.sum) / b.sum) * 100, basis };
}

/** 선택 연도의 집계 완료 구간 vs 전년 같은 달 구간 */
export function compareYear(year: number, totals: Map<string, number>, ctx: PeriodContext): Comparison {
  const span = yearSpan(year, ctx);
  if (!span) return { status: "insufficient", reason: `${year}년에 집계 완료된 달이 없음`, basis: "yoy" };
  const aFrom = ymOf(year, span.from);
  const aTo = ymOf(year, span.to);
  const bFrom = ymOf(year - 1, span.from);
  const bTo = ymOf(year - 1, span.to);
  const a = { label: monthSpanLabel(year, span.from, span.to), from: aFrom, to: aTo, sum: sumRange(totals, aFrom, aTo) };
  const b = { label: monthSpanLabel(year - 1, span.from, span.to), from: bFrom, to: bTo, sum: sumRange(totals, bFrom, bTo) };
  return finish("yoy", a, b, ctx);
}

/** 집계 완료 마지막 달 기준 최근 12개월 vs 직전 12개월 */
export function compareRolling12(totals: Map<string, number>, ctx: PeriodContext): Comparison {
  if (!ctx.completeThrough) return { status: "insufficient", reason: "집계 완료된 달을 확인할 수 없음", basis: "rolling12" };
  const aTo = ctx.completeThrough;
  const aFrom = shiftYm(aTo, -11);
  const bTo = shiftYm(aTo, -12);
  const bFrom = shiftYm(aTo, -23);
  const a = { label: ymSpanLabel(aFrom, aTo), from: aFrom, to: aTo, sum: sumRange(totals, aFrom, aTo) };
  const b = { label: ymSpanLabel(bFrom, bTo), from: bFrom, to: bTo, sum: sumRange(totals, bFrom, bTo) };
  return finish("rolling12", a, b, ctx);
}

/**
 * 품목 단위: 포장단위가 "박스"로 확인되고 박스당 입수가 양수일 때만 박스 환산(입수 반환), 아니면 null(낱개).
 * 83*155 같은 규격 코드·파렛트·필름·없음은 낱개 그대로.
 */
export function boxSizeOf(packUnit: string | null | undefined, unitsPerBox: number | null | undefined): number | null {
  return (packUnit ?? "").trim() === "박스" && typeof unitsPerBox === "number" && Number.isFinite(unitsPerBox) && unitsPerBox > 0 ? unitsPerBox : null;
}

/** 낱개 수량 표시: 입수 있으면 "2박스 50개" / "3박스" / "50개", 없으면 "1,234개" */
export function formatUnits(units: number, boxSize: number | null): string {
  const sign = units < 0 ? "−" : "";
  const n = Math.round(Math.abs(units));
  if (!boxSize) return `${sign}${n.toLocaleString("ko-KR")}개`;
  const boxes = Math.floor(n / boxSize);
  const rest = n - boxes * boxSize;
  if (boxes === 0) return `${sign}${rest.toLocaleString("ko-KR")}개`;
  return `${sign}${boxes.toLocaleString("ko-KR")}박스${rest ? ` ${rest.toLocaleString("ko-KR")}개` : ""}`;
}

/** 비교 한 줄: "2025년 1~9월 ○○ / 2024년 1~9월 ○○ / 전년 동기간 대비 +5.6%" */
export function describeComparison(c: Comparison, boxSize: number | null): string[] {
  const label = c.basis === "yoy" ? "전년 동기간 대비" : "직전 12개월 대비";
  if (c.status === "insufficient") {
    const head = c.a && c.b ? [`${c.a.label} · ${c.b.label}`] : [];
    return [...head, `비교 자료 부족 — ${c.reason}`];
  }
  const a = `${c.a.label} ${formatUnits(c.a.sum, boxSize)}`;
  const b = `${c.b.label} ${formatUnits(c.b.sum, boxSize)}`;
  if (c.status === "prevZero") return [a, b, "이전 기간 출고 0 · 증감률 산정 불가"];
  const pct = `${c.pct >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%`;
  return [a, b, `${label} ${pct}`];
}

export type YearChoice = number | "all";

/** ?year= 해석: 숫자면 그 해(자료 있는 해만), "all"이면 전체 기간, 없으면 자료가 있는 최신 연도 */
export function parseYear(raw: string | null | undefined, ctx: PeriodContext): YearChoice {
  const years = yearsOf(ctx);
  if (raw === "all") return "all";
  const n = Number(raw);
  if (Number.isInteger(n) && years.includes(n)) return n;
  return years.at(-1) ?? "all";
}
