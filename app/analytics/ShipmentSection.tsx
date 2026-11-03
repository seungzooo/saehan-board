"use client";

import { AllPeriodChart, YearMonthChart } from "@/components/charts";
import {
  allSeries,
  buildContext,
  compareRolling12,
  compareYear,
  describeComparison,
  formatUnits,
  monthSpanLabel,
  shiftYm,
  yearSeries,
  yearSpan,
  yearsOf,
  ymSpanLabel,
  type YearChoice,
} from "@/lib/analytics/periods";
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
}: {
  period: PeriodData;
  data: MonthlyUnitsData;
  initialYear: YearChoice;
  scope: string;
  boxSize: number | null;
  /** JS 없이 눌러도 같은 화면이 되도록 href에 함께 넣을 쿼리 (예: code) */
  keepParams?: Record<string, string>;
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
        <p className="text-xs text-zinc-500">
          {unitNote} · 점을 누르면 그 달의 정확한 수량 · 끊긴 구간 = 자료 없음/집계 중, 0 = 집계 완료된 실제 0
        </p>
      </div>

      {year === "all" ? (
        <AllPeriodChart points={view.points} boxSize={boxSize} unit={unit} />
      ) : (
        <YearMonthChart points={view.points} boxSize={boxSize} unit={unit} />
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
