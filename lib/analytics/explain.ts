/**
 * 분석 화면의 "선택하면 펼치는 설명"과 "표로 보기" 값 — 순수 함수 (테스트 tests/explain.test.ts).
 * 차트 컴포넌트(components/PickChart)는 여기서 만든 문장·표를 그대로 보여 준다. 예시 수치를 하드코딩하지 않는다.
 */
import type { PickPoint, PickTable } from "@/components/PickChart";
import { formatUnits, shiftYm, type MonthPoint } from "./periods";
import type { ItemShipRow } from "./itemStats";

const pct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v)).toLocaleString("ko-KR")}%`;
const ymText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const STATUS_EMPTY: Record<MonthPoint["status"], string> = { ok: "", missing: "자료 없음 (누락)", incomplete: "자료 없음 (집계 중)", nodata: "자료 없음" };

/** 증감률 문자열: 기준 0이면 산정 불가 */
export function changeText(cur: number, prev: number | null | undefined): string | null {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return cur === 0 ? "변화 없음 (둘 다 0)" : "전년 0 → 증감률 산정 불가";
  return pct((cur / prev - 1) * 100);
}

/**
 * 월별 출고 차트 점·표. 값은 boxSize가 있으면 박스, 없으면 개.
 * 상세: "2025년 3월" / "정상 출고 1,234개" 또는 "출고 없음 (집계 완료된 실제 0)" 또는 "자료 없음 (집계 중)" / 전년 같은 달 비교 / (품목) 거래처
 */
export function monthView(
  points: MonthPoint[],
  normal: Map<string, number>,
  boxSize: number | null,
  opts: { labelMode: "month" | "ym"; itemRows?: ItemShipRow[]; isComplete: (ym: string) => boolean },
) {
  // 전년 같은 달: 그 달이 집계 완료일 때만 (없는 값은 0으로 채우지 않는다)
  const prevOf = (ym: string) => {
    const p = shiftYm(ym, -12);
    return opts.isComplete(p) ? (normal.get(p) ?? 0) : null;
  };
  const custOf = new Map<string, string[]>();
  for (const [ym, c, n] of opts.itemRows ?? []) if (n > 0) custOf.set(ym, [...(custOf.get(ym) ?? []), `${c} ${n}회`]);

  const pickPoints: PickPoint[] = points.map((p) => {
    const lines: string[] = [];
    if (p.units === null) lines.push(STATUS_EMPTY[p.status] || "자료 없음");
    else if (p.units === 0) lines.push("출고 없음 (집계 완료된 실제 0)");
    else lines.push(`정상 출고 ${formatUnits(p.units, boxSize)}`);
    const prev = p.units === null ? null : prevOf(p.ym);
    if (p.units !== null && prev !== null) {
      const ch = changeText(p.units, prev);
      lines.push(`전년 같은 달(${ymText(shiftYm(p.ym, -12))}) ${formatUnits(prev, boxSize)}${ch ? ` · ${ch}` : ""}`);
    }
    const cs = custOf.get(p.ym);
    if (opts.itemRows && p.units !== null && p.units > 0 && cs) lines.push(`거래처 ${cs.length}곳: ${cs.slice(0, 3).join(", ")}${cs.length > 3 ? " 외" : ""}`);
    return {
      label: opts.labelMode === "month" ? `${p.month}월` : `${p.ym.slice(2, 4)}.${p.ym.slice(5, 7)}`,
      values: [p.units === null ? null : boxSize ? p.units / boxSize : p.units],
      detail: { title: ymText(p.ym), lines },
    };
  });
  const table: PickTable = {
    headers: ["월", "정상 출고", "전년 같은 달", "증감"],
    rows: points.map((p) => {
      const prev = p.units === null ? null : prevOf(p.ym);
      return [
        ymText(p.ym),
        p.units === null ? STATUS_EMPTY[p.status] || "자료 없음" : p.units === 0 ? "출고 없음" : formatUnits(p.units, boxSize),
        prev === null ? "—" : formatUnits(prev, boxSize),
        p.units === null ? "—" : (changeText(p.units, prev) ?? "—"),
      ];
    }),
  };
  return { points: pickPoints, table };
}

/** 품목 24개월 생산·정상 판매 비교 (두 선) */
export function trendView(rows: { yearMonth: string; production: number; shipment: number }[], boxSize: number | null) {
  const v = (n: number) => (boxSize ? n / boxSize : n);
  return {
    points: rows.map((r): PickPoint => ({
      label: `${r.yearMonth.slice(2, 4)}.${r.yearMonth.slice(5, 7)}`,
      values: [v(r.production), v(r.shipment)],
      detail: {
        title: ymText(r.yearMonth),
        lines: [
          `생산 ${r.production === 0 ? "없음" : formatUnits(r.production, boxSize)} · 정상 출고 ${r.shipment === 0 ? "없음" : formatUnits(r.shipment, boxSize)}`,
          r.production > 0 ? `출고 ÷ 생산 = ${((r.shipment / r.production) * 100).toFixed(0)}% (같은 달 합계 비교, 개별 로트 추적 아님)` : "이 달 생산 기록 없음",
        ],
      },
    })),
    table: {
      headers: ["월", "생산", "정상 출고"],
      rows: rows.map((r) => [ymText(r.yearMonth), r.production === 0 ? "없음" : formatUnits(r.production, boxSize), r.shipment === 0 ? "없음" : formatUnits(r.shipment, boxSize)]),
    } satisfies PickTable,
  };
}

/** 품목 월별 반품 막대 */
export function returnsView(rows: { yearMonth: string; returns: number }[], boxSize: number | null) {
  return {
    points: rows.map((r): PickPoint => ({
      label: `${r.yearMonth.slice(2, 4)}.${r.yearMonth.slice(5, 7)}`,
      values: [boxSize ? r.returns / boxSize : r.returns],
      detail: { title: ymText(r.yearMonth), lines: [r.returns === 0 ? "반품 없음" : `반품 ${formatUnits(r.returns, boxSize)} (판매와 별도 집계)`] },
    })),
    table: { headers: ["월", "반품"], rows: rows.map((r) => [ymText(r.yearMonth), r.returns === 0 ? "없음" : formatUnits(r.returns, boxSize)]) } satisfies PickTable,
  };
}

/** 5년 평균 계절지수 막대: 지수 = 그 달 평균 ÷ 전체 월평균 */
export function seasonAvgView(rows: { month: number; index: number | null; avg: number }[], unitLabel: string, peak: number) {
  const overall = rows.length ? rows.reduce((s, r) => s + r.avg, 0) / rows.length : 0;
  return {
    points: rows.map((r): PickPoint => ({
      label: `${r.month}월`,
      values: [r.index],
      highlight: (r.index ?? 0) >= peak,
      detail: {
        title: `${r.month}월 (5년 평균)`,
        lines:
          r.index === null
            ? ["전체 월평균이 0이라 지수 산정 불가"]
            : [
                `${r.month}월 평균 ${Math.round(r.avg).toLocaleString()}${unitLabel} · 전체 월평균 ${Math.round(overall).toLocaleString()}${unitLabel}`,
                `평소(전체 월평균)의 ${r.index.toFixed(2)}배 = ${pct((r.index - 1) * 100)}${r.index >= peak ? " · 성수기" : ""}`,
              ],
      },
    })),
    table: {
      headers: ["월", "평균 출고", "평소 대비"],
      rows: rows.map((r) => [`${r.month}월`, `${Math.round(r.avg).toLocaleString()}${unitLabel}`, r.index === null ? "산정 불가" : `${r.index.toFixed(2)}배 (${pct((r.index - 1) * 100)})`]),
    } satisfies PickTable,
  };
}

/**
 * 연도별 정상 출고 합계 + 전년 대비 증가율. 집계 완료된 달만 더한다.
 * 그 해가 일부 달만 완료면(예: 1~3월) 전년도 같은 달끼리 비교하고 "1~3월 동기간"이라고 밝힌다. 전년 합 0이면 산정 불가.
 */
export function yearlyTotalsView(years: number[], normal: Map<string, number>, isComplete: (ym: string) => boolean, boxSize: number | null) {
  const monthsOf = (y: number) => Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`).filter(isComplete);
  const sum = (ms: string[]) => ms.reduce((s, ym) => s + (normal.get(ym) ?? 0), 0);
  const rows = years.map((y) => {
    const ms = monthsOf(y);
    const total = sum(ms);
    const prevMs = ms.map((ym) => `${y - 1}${ym.slice(4)}`);
    const prevOk = ms.length > 0 && prevMs.every(isComplete);
    const prev = prevOk ? sum(prevMs) : null;
    const [m0, m1] = ms.length ? [Number(ms[0].slice(5)), Number(ms.at(-1)!.slice(5))] : [0, 0];
    const span = ms.length === 12 ? "1~12월" : ms.length ? (m0 === m1 ? `${m0}월` : `${m0}~${m1}월`) : "집계 완료된 달 없음";
    const yoy = prev === null ? null : prev === 0 ? "산정 불가" : pct((total / prev - 1) * 100);
    return { y, ms, total, prev, span, yoy };
  });
  const yoyLabel = (r: (typeof rows)[number]) => (r.yoy === null ? "" : r.yoy === "산정 불가" ? "" : ` ${r.yoy}`);
  return {
    points: rows.map((r): PickPoint => ({
      label: `${r.y}${yoyLabel(r)}`,
      values: [r.ms.length ? (boxSize ? r.total / boxSize : r.total) : null],
      detail: {
        title: `${r.y}년 (${r.span})`,
        lines: [
          r.ms.length ? `정상 출고 합계 ${formatUnits(r.total, boxSize)}` : "집계 완료된 달이 없어 합계를 내지 않습니다",
          r.prev === null
            ? "전년 비교 자료 없음"
            : r.yoy === "산정 불가"
              ? `전년 같은 기간 0 → 증가율 산정 불가`
              : `전년 ${r.ms.length === 12 ? "" : `${r.span} 동기간 `}${formatUnits(r.prev, boxSize)} 대비 ${r.yoy}`,
        ],
      },
    })),
    table: {
      headers: ["연도", "정상 출고 합계", "집계 기간", "전년 대비"],
      rows: rows.map((r) => [`${r.y}년`, r.ms.length ? formatUnits(r.total, boxSize) : "—", r.span, r.yoy ?? "—"]),
    } satisfies PickTable,
  };
}

/** 히트맵 셀: 반올림 전 지수로 낸 그해 월평균 대비 차이. 실제 0·자료 없음·기준값 0을 구분 */
export type HeatKind = "ok" | "zero" | "nodata" | "base0";
export function heatPct(index: number): string {
  return pct((index - 1) * 100);
}
export function heatCell(year: number, month: number, value: number | null, mean: number | null, rowStatus: "ok" | "zero" | "nodata", unit: string) {
  const title = `${year}년 ${month}월`;
  const n = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}${unit}`;
  if (value === null) return { kind: "nodata" as HeatKind, text: "—", title, lines: ["자료 없음 — 자료 범위 밖이거나 집계 중인 달이라 비교하지 않습니다."] };
  if (rowStatus === "zero" || !mean) return { kind: "base0" as HeatKind, text: "×", title, lines: [`${year}년 출고가 0이라 비교 기준(그해 월평균)이 0 — 차이를 낼 수 없습니다.`] };
  const index = value / mean;
  const diff = value - mean;
  const head = value === 0 ? "출고 없음 (실제 0)" : `실제 출고 ${n(value)}`;
  const sentence =
    value === 0
      ? `그해 평소 한 달에 ${n(mean)} 나가던 것에 비해 이 달은 출고가 없었습니다.`
      : `그해 평소보다 ${heatPct(index).replace(/^[+−]/, "")} ${diff >= 0 ? "많이" : "적게"} 출고됐습니다.`;
  return {
    kind: (value === 0 ? "zero" : "ok") as HeatKind,
    index,
    text: value === 0 ? "없음" : heatPct(index),
    title,
    lines: [`${head} · 그해 월평균 ${n(mean)} · 차이 ${diff >= 0 ? "+" : "−"}${n(Math.abs(diff))} (${heatPct(index)})`, sentence],
  };
}

/** 계절 TOP 10 근거: 집중된 달의 연도별 출고량과 그해 월평균 */
export type PeakEvidence = {
  month: number;
  /** 평소 = 분석 기간 전체 월평균(모든 달·모든 해) */
  overallMean: number;
  /** 그 달의 5년 평균 */
  monthMean: number;
  years: { year: number; value: number; yearMean: number; complete: boolean }[];
};
export const REPEAT_MIN_YEARS = 4;
export function peakPattern(e: PeakEvidence) {
  const comparable = e.years.filter((y) => y.complete && y.yearMean > 0);
  const over = comparable.filter((y) => y.value > y.yearMean);
  const total = e.years.reduce((s, y) => s + y.value, 0);
  const top = e.years.reduce((a, b) => (b.value > a.value ? b : a), e.years[0] ?? { year: 0, value: 0, yearMean: 0, complete: false });
  const share = total > 0 ? top.value / total : 0;
  const kind = over.length >= REPEAT_MIN_YEARS ? "repeat" : share >= 0.5 && over.length <= 2 ? "spike" : "partial";
  const label =
    kind === "repeat"
      ? `여러 해 반복 — ${comparable.length}개 해 중 ${over.length}개 해에서 그해 월평균보다 많음`
      : kind === "spike"
        ? `한 해 대량 출고로 높아짐 — ${top.year}년 ${e.month}월이 5년 같은 달 합계의 ${Math.round(share * 100)}%`
        : `일부 해만 — ${comparable.length}개 해 중 ${over.length}개 해에서 그해 월평균보다 많음`;
  return { kind, over: over.length, comparable: comparable.length, label, badge: kind === "repeat" };
}

/** 시차 라벨: 같은 달 / 다음 달 / 2개월 뒤 … */
export function lagLabel(k: number): string {
  return k === 0 ? "같은 달" : k === 1 ? "다음 달" : `${k}개월 뒤`;
}
/** 계수가 이 차이 이내면 "비슷한 관계" */
export const LAG_SIMILAR = 0.05;

function strength(r: number): string {
  if (r >= 0.7) return "뚜렷하게 함께 많았습니다";
  if (r >= 0.4) return "어느 정도 함께 많았습니다";
  if (r >= 0.2) return "약하게 함께 많았습니다";
  if (r > -0.2) return "함께 움직이는 관계가 거의 보이지 않았습니다";
  return "오히려 반대로 움직이는 경향이 보였습니다";
}

/**
 * 생산·출고 시차 막대: 막대 = 시차별 상관계수. 선택하면 두 비교 대상과 결과를 문장으로.
 * 월별 합계끼리의 비교일 뿐이므로 개별 제품의 출고일·납기를 단정하지 않는다.
 */
export function lagView(rows: { lag: number; r: number | null; n: number }[], best: number | null) {
  const valid = rows.filter((r) => r.r !== null) as { lag: number; r: number; n: number }[];
  const points: PickPoint[] = rows.map((row) => {
    const when = lagLabel(row.lag);
    const lines: string[] = [`비교: 생산량(생산한 달) ↔ ${when === "같은 달" ? "같은 달" : `그 ${when}`} 출고량, 월별 합계 ${row.n}개 달 쌍`];
    if (row.r === null) lines.push("비교한 달 쌍이 3개 미만이거나 변동이 없어 관계를 산정할 수 없습니다.");
    else {
      lines.push(`결과: 생산이 많았던 달에는 ${when === "같은 달" ? "같은 달" : when} 출고도 ${strength(row.r)}`);
      const similar = valid.filter((o) => o.lag !== row.lag && Math.abs(o.r - row.r!) <= LAG_SIMILAR);
      if (similar.length) {
        const list = similar.map((o) => lagLabel(o.lag)).join(", ");
        lines.push(`${list}${withJosa(list)}도 비슷한 관계가 관찰됐습니다 — 어느 시차가 맞다고 단정할 수 없습니다.`);
      }
    }
    lines.push("월별 합계 기준이며 개별 로트의 출고 시점은 아님 — 이 결과로 특정 제품의 출고일이나 납기를 정할 수 없습니다.");
    return { label: when, values: [row.r], highlight: row.lag === best, detail: { title: `${when} 비교`, lines } };
  });
  return {
    points,
    table: {
      headers: ["시차", "상관계수", "비교한 달 쌍"],
      rows: rows.map((r) => [lagLabel(r.lag), r.r === null ? "산정 불가" : r.r.toFixed(2), `${r.n}개`]),
    } satisfies PickTable,
  };
}

/** 한 줄 답 — 계수·월 수는 '계산 기준'에. 기존 해석 문구 유지 */
export function lagAnswer(rows: { lag: number; r: number | null; n: number }[], best: { lag: number; r: number | null } | null): string {
  if (!best || best.r === null) return "생산·출고 관계를 산정할 수 없습니다 (비교할 달이 부족하거나 변동이 없음).";
  const when = best.lag === 0 ? "동월" : `${best.lag}개월 차이`;
  const similar = rows.filter((o) => o.lag !== best.lag && o.r !== null && Math.abs(o.r - best.r!) <= LAG_SIMILAR).map((o) => lagLabel(o.lag));
  return `${when} 생산량과 출고량이 가장 비슷하게 움직임 · 월별 합계 기준이며 개별 로트의 출고 시점은 아님${similar.length ? ` (${similar.join(", ")}도 비슷한 관계)` : ""}`;
}

/** 받침이 있으면 "과", 없으면 "와" */
function withJosa(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return "와";
  return (c - 0xac00) % 28 === 0 ? "와" : "과";
}
