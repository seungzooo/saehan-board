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
