"use client";

import PickChart from "@/components/PickChart";
import { COLOR_SHIPMENT } from "@/components/charts";
import { monthView } from "@/lib/analytics/explain";
import {
  allSeries,
  buildContext,
  compareRolling12,
  compareYear,
  describeComparison,
  formatUnits,
  monthStatus,
  monthSpanLabel,
  shiftYm,
  yearSeries,
  yearSpan,
  yearsOf,
  ymSpanLabel,
  type YearChoice,
} from "@/lib/analytics/periods";
import { INTERMITTENT_NOTE, isIntermittent, isMonthEndOnly, MONTH_END_NOTE, summarizeItem, summaryLine, type ItemShipData } from "@/lib/analytics/itemStats";
import type { MonthlyUnitsData, PeriodData } from "@/lib/analytics/shipments";
import { useMemo, useState } from "react";

function sumBetween(m: Map<string, number>, from: string, to: string) {
  let s = 0;
  for (let ym = from; ym <= to; ym = shiftYm(ym, 1)) s += m.get(ym) ?? 0;
  return s;
}

/**
 * 월별 출고량 차트 + 비교 수치. 연도별 월 합계(전 기간)와 비교에 필요한 값을 처음 한 번에 받아 두고,
 * 연도 버튼은 화면에서 바로 바꾼다 — 서버 왕복 없음. 주소의 ?year=는 history.replaceState로 갱신.
 * 연도 버튼은 이 차트와 바로 아래 비교 수치에만 적용된다.
 */
export default function ShipmentSection({
  period,
  data,
  initialYear,
  scope,
  boxSize,
  keepParams = {},
  item,
}: {
  period: PeriodData;
  data: MonthlyUnitsData;
  initialYear: YearChoice;
  scope: string;
  boxSize: number | null;
  /** JS 없이 눌러도 같은 화면이 되도록 href에 함께 넣을 쿼리 (예: code) */
  keepParams?: Record<string, string>;
  /** 품목을 골랐을 때: 막대 차트 + 출고 요약 한 줄 + 간헐 출고·월말 일괄 안내. 없으면 전체 거래처 합계(선) */
  item?: ItemShipData;
}) {
  const ctx = useMemo(() => buildContext(period.presentMonths, period.declaredThrough), [period]);
  const normal = useMemo(() => new Map(data.normal), [data]);
  const returns = useMemo(() => new Map(data.returns), [data]);
  const [year, setYear] = useState<YearChoice>(initialYear);
  const years = yearsOf(ctx);
  const unit = boxSize ? "박스" : "개";
  const unitNote = boxSize ? `단위 박스 (1박스 ${boxSize.toLocaleString()}개, 나머지는 개)` : "단위 개(낱개)";

  function choose(y: YearChoice) {
    setYear(y);
    const u = new URL(window.location.href);
    u.searchParams.set("year", String(y));
    window.history.replaceState(window.history.state, "", `${u.pathname}${u.search}`);
  }

  const view = useMemo(() => {
    if (year === "all") {
      const last = ctx.completeThrough;
      let periodLine = ctx.firstYm && ctx.lastYm ? `${scope} · 정상 출고 · ${ctx.firstYm}~${ctx.lastYm}` : `${scope} · 정상 출고 · 자료 없음`;
      if (last && ctx.lastYm && last < ctx.lastYm) periodLine += ` (집계 완료 ${last}까지)`;
      const comparison = compareRolling12(normal, ctx);
      const returnsLine = comparison.a
        ? `최근 12개월(${ymSpanLabel(comparison.a.from, comparison.a.to)}) 반품 ${formatUnits(sumBetween(returns, comparison.a.from, comparison.a.to), boxSize)} (판매와 별도 집계)`
        : ctx.firstYm && last
          ? `전체 기간(${ymSpanLabel(ctx.firstYm, last)}) 반품 ${formatUnits(sumBetween(returns, ctx.firstYm, last), boxSize)} (판매와 별도 집계)`
          : null;
      return { title: "전체 기간 월별 출고량", periodLine, points: allSeries(normal, ctx), comparison, returnsLine };
    }
    const points = yearSeries(year, normal, ctx);
    const span = yearSpan(year, ctx);
    let periodLine = `${scope} · 정상 출고 · ${span ? monthSpanLabel(year, span.from, span.to) : `${year}년 집계 완료된 달 없음`}`;
    const pending = points.filter((p) => p.status === "incomplete").map((p) => `${p.month}월`);
    if (pending.length) periodLine += ` (${pending.join("·")} 집계 중)`;
    const comparison = compareYear(year, normal, ctx);
    let returnsLine: string | null = null;
    if (span) {
      const from = `${year}-${String(span.from).padStart(2, "0")}`;
      const to = `${year}-${String(span.to).padStart(2, "0")}`;
      returnsLine = `${monthSpanLabel(year, span.from, span.to)} 반품 ${formatUnits(sumBetween(returns, from, to), boxSize)} (판매와 별도 집계)`;
    }
    return { title: `${year}년 월별 출고량`, periodLine, points, comparison, returnsLine };
  }, [year, ctx, normal, returns, scope, boxSize]);

  // 품목 요약: 그 기간의 집계 완료된 달만 분모. 전체 기간 보기의 간헐 판정은 최근 집계 완료 12개월
  const itemView = useMemo(() => {
    if (!item) return null;
    const okMonths = view.points.filter((p) => p.status === "ok").map((p) => p.ym);
    const label = year === "all" ? "전체 기간" : `${year}년`;
    const summary = summarizeItem(item.rows, okMonths);
    const recent = year === "all" ? summarizeItem(item.rows, okMonths.slice(-12)) : summary;
    return { line: summaryLine(label, summary), intermittent: isIntermittent(recent), monthEnd: isMonthEndOnly(item) };
  }, [item, view.points, year]);

  // 막대·점을 누르면 펼칠 설명과 표 — 같은 값
  const pick = useMemo(
    () => monthView(view.points, normal, boxSize, { labelMode: year === "all" ? "ym" : "month", itemRows: item?.rows, isComplete: (ym) => monthStatus(ym, ctx) === "ok" }),
    [view.points, normal, boxSize, year, item, ctx],
  );

  const lines = describeComparison(view.comparison, boxSize);
  const c = view.comparison;

  return (
    <section data-testid="shipment-section" className="flex flex-col gap-2">
      <nav className="flex flex-wrap gap-1" aria-label="기간 선택" data-testid="year-buttons">
        {(["all", ...years] as YearChoice[]).map((y) => (
          <a
            key={String(y)}
            href={`?${new URLSearchParams({ ...keepParams, year: String(y) })}`}
            onClick={(e) => {
              e.preventDefault();
              choose(y);
            }}
            aria-current={year === y ? "page" : undefined}
            className={`num flex h-10 items-center rounded-md border px-3 text-sm ${
              year === y ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-zinc-300 text-zinc-700 hover:bg-blue-50"
            }`}
          >
            {y === "all" ? "전체 기간" : `${y}년`}
          </a>
        ))}
      </nav>

      <div>
        <h2 className="text-base font-semibold" data-testid="shipment-title">
          {view.title}
        </h2>
        <p className="num text-xs text-zinc-600" data-testid="shipment-period">
          {view.periodLine}
        </p>
        {itemView && (
          <p className="num text-sm font-medium text-zinc-800" data-testid="item-summary">
            {itemView.line}
          </p>
        )}
        {itemView?.monthEnd && (
          <p className="text-xs text-amber-800" data-testid="month-end-note">
            {MONTH_END_NOTE}
          </p>
        )}
        <p className="text-xs text-zinc-500">
          {item
            ? `${unitNote} · 막대 없음 = 출고 없음 또는 자료 없음(눌러서 구분)`
            : `${unitNote} · 끊긴 구간 = 자료 없음/집계 중, 0 = 집계 완료된 실제 0`}
        </p>
      </div>

      <PickChart
        key={String(year)}
        testid={year === "all" ? "all-period-chart" : "year-month-chart"}
        points={pick.points}
        table={pick.table}
        series={[{ name: "정상 출고", color: COLOR_SHIPMENT, kind: item ? "bar" : "line" }]}
        yUnit={unit}
        hideXTicks={year === "all"}
        yearMarks={year === "all" ? view.points.flatMap((p, i) => (p.month === 1 ? [{ index: i, label: `${p.ym.slice(0, 4)}년` }] : [])) : []}
      />

      {itemView?.intermittent && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="intermittent-note">
          {INTERMITTENT_NOTE}
        </p>
      )}

      <div className="rounded-lg border border-zinc-200 p-3" data-testid="shipment-compare">
        <p className="text-xs text-zinc-500">{c.basis === "yoy" ? "선택 연도와 전년 같은 기간 비교" : "집계 완료 마지막 달 기준 최근 12개월과 직전 12개월 비교"}</p>
        <ol className="num mt-1 flex flex-col gap-0.5 text-sm">
          {lines.map((l, i) => (
            <li key={l} className={i === lines.length - 1 ? "font-semibold text-zinc-900" : "text-zinc-800"} data-testid={`compare-line-${i}`}>
              {l}
            </li>
          ))}
        </ol>
        {view.returnsLine && <p className="num mt-1 text-xs text-zinc-500">{view.returnsLine}</p>}
        {c.status !== "insufficient" && c.basis === "rolling12" && (
          <p className="num mt-1 text-xs text-zinc-500">
            최근 {ymSpanLabel(c.a.from, c.a.to)} · 직전 {ymSpanLabel(c.b.from, c.b.to)}
          </p>
        )}
      </div>
    </section>
  );
}
