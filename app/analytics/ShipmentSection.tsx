import { AllPeriodChart, YearMonthChart } from "@/components/charts";
import {
  allSeries,
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
  type PeriodContext,
} from "@/lib/analytics/periods";
import type { MonthlyUnits } from "@/lib/analytics/shipments";
import Link from "next/link";

export type YearChoice = number | "all";

/** ?year= 해석: 숫자면 그 해(자료 있는 해만), "all"이면 전체 기간, 없으면 자료가 있는 최신 연도 */
export function parseYear(raw: string | undefined, ctx: PeriodContext): YearChoice {
  const years = yearsOf(ctx);
  if (raw === "all") return "all";
  const n = Number(raw);
  if (Number.isInteger(n) && years.includes(n)) return n;
  return years.at(-1) ?? "all";
}

function sumBetween(m: Map<string, number>, from: string, to: string) {
  let s = 0;
  for (let ym = from; ym <= to; ym = shiftYm(ym, 1)) s += m.get(ym) ?? 0;
  return s;
}

/**
 * 월별 출고량 차트 + 비교 수치. 연도 버튼은 이 차트와 바로 아래 비교에만 적용된다.
 * scope: "전체 거래처" 또는 품목명. boxSize: 박스 환산 입수(없으면 낱개).
 */
export default function ShipmentSection({
  ctx,
  units,
  year,
  hrefFor,
  scope,
  boxSize,
}: {
  ctx: PeriodContext;
  units: MonthlyUnits;
  year: YearChoice;
  hrefFor: (y: YearChoice) => string;
  scope: string;
  boxSize: number | null;
}) {
  const years = yearsOf(ctx);
  const unit = boxSize ? "박스" : "개";
  const unitNote = boxSize ? `단위 박스 (1박스 ${boxSize.toLocaleString()}개, 나머지는 개)` : "단위 개(낱개)";

  let title: string;
  let periodLine: string;
  let chart: React.ReactNode;
  let comparison;
  let returnsLine: string | null = null;

  if (year === "all") {
    const pts = allSeries(units.normal, ctx);
    title = "전체 기간 월별 출고량";
    const last = ctx.completeThrough;
    periodLine = ctx.firstYm && ctx.lastYm ? `${scope} · 정상 출고 · ${ctx.firstYm}~${ctx.lastYm}` : `${scope} · 정상 출고 · 자료 없음`;
    if (last && ctx.lastYm && last < ctx.lastYm) periodLine += ` (집계 완료 ${last}까지)`;
    chart = <AllPeriodChart points={pts} boxSize={boxSize} unit={unit} />;
    comparison = compareRolling12(units.normal, ctx);
    if (comparison.status !== "insufficient" || comparison.a)
      returnsLine = comparison.a
        ? `최근 12개월(${ymSpanLabel(comparison.a.from, comparison.a.to)}) 반품 ${formatUnits(sumBetween(units.returns, comparison.a.from, comparison.a.to), boxSize)} (판매와 별도 집계)`
        : null;
    if (!returnsLine && ctx.firstYm && last)
      returnsLine = `전체 기간(${ymSpanLabel(ctx.firstYm, last)}) 반품 ${formatUnits(sumBetween(units.returns, ctx.firstYm, last), boxSize)} (판매와 별도 집계)`;
  } else {
    const pts = yearSeries(year, units.normal, ctx);
    const span = yearSpan(year, ctx);
    title = `${year}년 월별 출고량`;
    periodLine = `${scope} · 정상 출고 · ${span ? monthSpanLabel(year, span.from, span.to) : `${year}년 집계 완료된 달 없음`}`;
    const pending = pts.filter((p) => p.status === "incomplete").map((p) => `${p.month}월`);
    if (pending.length) periodLine += ` (${pending.join("·")} 집계 중)`;
    chart = <YearMonthChart points={pts} boxSize={boxSize} unit={unit} />;
    comparison = compareYear(year, units.normal, ctx);
    if (span) {
      const from = `${year}-${String(span.from).padStart(2, "0")}`;
      const to = `${year}-${String(span.to).padStart(2, "0")}`;
      returnsLine = `${monthSpanLabel(year, span.from, span.to)} 반품 ${formatUnits(sumBetween(units.returns, from, to), boxSize)} (판매와 별도 집계)`;
    }
  }
  const lines = describeComparison(comparison, boxSize);

  return (
    <section data-testid="shipment-section" className="flex flex-col gap-2">
      <nav className="flex flex-wrap gap-1" aria-label="기간 선택" data-testid="year-buttons">
        {(["all", ...years] as YearChoice[]).map((y) => (
          <Link
            key={String(y)}
            href={hrefFor(y)}
            scroll={false}
            aria-current={year === y ? "page" : undefined}
            className={`num flex h-10 items-center rounded-md border px-3 text-sm ${
              year === y ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-zinc-300 text-zinc-700 hover:bg-blue-50"
            }`}
          >
            {y === "all" ? "전체 기간" : `${y}년`}
          </Link>
        ))}
      </nav>

      <div>
        <h2 className="text-base font-semibold" data-testid="shipment-title">
          {title}
        </h2>
        <p className="num text-xs text-zinc-600" data-testid="shipment-period">
          {periodLine}
        </p>
        <p className="text-xs text-zinc-500">
          {unitNote} · 점을 누르면 그 달의 정확한 수량 · 끊긴 구간 = 자료 없음/집계 중, 0 = 집계 완료된 실제 0
        </p>
      </div>

      {chart}

      <div className="rounded-lg border border-zinc-200 p-3" data-testid="shipment-compare">
        <p className="text-xs text-zinc-500">{comparison.basis === "yoy" ? "선택 연도와 전년 같은 기간 비교" : "집계 완료 마지막 달 기준 최근 12개월과 직전 12개월 비교"}</p>
        <ol className="num mt-1 flex flex-col gap-0.5 text-sm">
          {lines.map((l, i) => (
            <li key={l} className={i === lines.length - 1 ? "font-semibold text-zinc-900" : "text-zinc-800"} data-testid={`compare-line-${i}`}>
              {l}
            </li>
          ))}
        </ol>
        {returnsLine && <p className="num mt-1 text-xs text-zinc-500">{returnsLine}</p>}
        {comparison.status !== "insufficient" && comparison.basis === "rolling12" && (
          <p className="num mt-1 text-xs text-zinc-500">
            최근 {ymSpanLabel(comparison.a.from, comparison.a.to)} · 직전 {ymSpanLabel(comparison.b.from, comparison.b.to)}
          </p>
        )}
      </div>
    </section>
  );
}
