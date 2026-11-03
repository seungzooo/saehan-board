import { ChartHead, LagChart } from "@/components/charts";
import YearHeatmap from "@/components/YearHeatmap";
import { cachedAnalysisBasis, cachedCompletionInfo, cachedItemShipData, cachedMonthlyUnits, cachedOverview, cachedPeriodData, cachedProductAnalysis } from "@/lib/analytics/cached";
import { allSeries, boxSizeOf, formatUnits, parseYear, type PeriodContext, type YearChoice } from "@/lib/analytics/periods";
import { getLiveStock, MAX_LAG, MIN_ACTIVE_MONTHS, searchAnalysisProducts, seoulMonth, TREND_MONTHS, type AnalysisBasis } from "@/lib/analytics/query";
import {
  describeLagCalendar,
  describeNow,
  describeSeason,
  describeYearly,
  PEAK_INDEX,
  seasonalIndex,
  yearlySeasonal,
  type LagRow,
} from "@/lib/analytics/seasonal";
import { contextOf, unitsOf, type CompletionInfo, type PeriodData } from "@/lib/analytics/shipments";
import { formatDateTime } from "@/lib/format";
import { availableText, daysText, productInfoText, StatusBadge, stockStatus } from "@/lib/stockDisplay";
import Link from "next/link";
import Section from "./Section";
import ShipmentSection from "./ShipmentSection";
import TopTable from "./TopTable";
import { stockCell } from "@/lib/analytics/stockCell";
import PickChart from "@/components/PickChart";
import { COLOR_PRODUCTION, COLOR_SHIPMENT } from "@/components/charts";
import { returnsView, seasonAvgView, trendView } from "@/lib/analytics/explain";

export const dynamic = "force-dynamic";

/**
 * F5 분석 — 이사님 문제 ①: 생산·판매 상관관계, 시기별·계절별 패턴.
 * 월별 출고량 = 전체 거래처 정상 출고(낱개), 연도 버튼으로 기간 선택. 반품은 별도.
 * B2B/B2C 구분은 회사 분류표 확인 전까지 숨김 — ?seg= 주소도 전체 거래처로 집계한다.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ code?: string; q?: string; seg?: string; year?: string }> }) {
  const sp = await searchParams;
  const [basis, period, completion] = await Promise.all([cachedAnalysisBasis(), cachedPeriodData(), cachedCompletionInfo()]);
  const ctx = contextOf(period);
  const q = sp.q?.trim() ?? "";
  const year = parseYear(sp.year, ctx);
  const link = (params: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
    const s = u.toString();
    return `/analytics${s ? `?${s}` : ""}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4 lg:max-w-5xl lg:px-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold">생산·판매 분석</h1>
          {sp.code && (
            <Link href={link({ year: sp.year })} className="text-sm text-blue-600">
              전체 요약
            </Link>
          )}
        </div>
        <BasisNote basis={basis} ctx={ctx} completion={completion} />
        <form action="/analytics" className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="분석할 품목 (품명·품번)"
            aria-label="분석할 품목 검색"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 text-base outline-none focus:border-blue-600"
          />
          <button type="submit" className="h-12 shrink-0 rounded-lg bg-blue-600 px-4 text-base font-semibold text-white">
            찾기
          </button>
        </form>
      </header>

      {q && !sp.code ? (
        <SearchResults q={q} link={link} />
      ) : sp.code ? (
        <ProductView code={sp.code} period={period} year={year} />
      ) : (
        <Overview period={period} year={year} link={link} />
      )}
    </main>
  );
}

function BasisNote({ basis, ctx, completion }: { basis: AnalysisBasis; ctx: PeriodContext; completion: CompletionInfo }) {
  const src = completion.sales;
  return (
    <div className="num flex flex-col gap-0.5 text-xs text-zinc-500" data-testid="analysis-basis">
      <p>
        실적 기준: 정상 출고 {basis.shipmentTo ?? "없음"} · 생산 {basis.productionTo ?? "없음"} · 출고 자료 {ctx.firstYm ?? "없음"}~{ctx.lastYm ?? ""}. 판매 = 정상
        출고(판매형태 전체), 반품 별도. 거래처 유형(B2B/B2C) 구분은 회사 분류표 확인 전까지 쓰지 않습니다.
      </p>
      <p data-testid="completion-source">
        {ctx.completeThrough ? (
          <>
            <b className="text-zinc-700">집계 완료 {ctx.completeThrough}까지</b>
            {src && (
              <>
                {" "}
                — 출고실적 업로드{" "}
                <Link href={`/upload/${src.id}`} className="text-blue-600 underline">
                  {src.fileName}
                </Link>{" "}
                ({formatDateTime(new Date(src.uploadedAt))})에서 정함
              </>
            )}
          </>
        ) : (
          "집계 완료 월이 정해진 출고실적 업로드가 없어 마지막 달은 집계 중으로 봅니다."
        )}
      </p>
    </div>
  );
}

function LagTable({ rows, best }: { rows: LagRow[]; best: number | null }) {
  return (
    <table className="num mt-1 w-full table-fixed text-center text-xs" data-testid="lag-table">
      <thead className="text-zinc-500">
        <tr>
          <th className="py-1 text-left font-medium">k</th>
          {rows.map((r) => (
            <th key={r.lag} className={`py-1 font-medium ${r.lag === best ? "text-blue-800" : ""}`}>
              +{r.lag}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="py-1 text-left text-zinc-500">r</td>
          {rows.map((r) => (
            <td key={r.lag} className={r.lag === best ? "font-bold text-blue-800" : ""}>
              {r.r === null ? "—" : r.r.toFixed(2)}
            </td>
          ))}
        </tr>
        <tr>
          <td className="py-1 text-left text-zinc-500">쌍</td>
          {rows.map((r) => (
            <td key={r.lag} className="text-zinc-600">
              {r.n}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

async function SearchResults({ q, link }: { q: string; link: (p: Record<string, string | undefined>) => string }) {
  const items = await searchAnalysisProducts(q);
  if (items.length === 0) return <p className="py-8 text-center text-sm text-zinc-500">일치하는 품목 없음</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((p) => (
        <li key={p.code}>
          <Link
            href={link({ code: p.code })}
            className={`flex min-h-12 items-center gap-2 rounded-lg border px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 ${p.analyzable ? "border-zinc-200" : "border-dashed border-zinc-300"}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name}</p>
              <p className="truncate text-xs text-zinc-500">{productInfoText(p)}</p>
            </div>
            {!p.analyzable && (
              <span className="shrink-0 rounded border border-dashed border-zinc-400 px-1.5 py-0.5 text-xs text-zinc-600">생산 비교 불가</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function ProductView({ code, period, year }: { code: string; period: PeriodData; year: YearChoice }) {
  const [a, unitsData, live, itemData] = await Promise.all([cachedProductAnalysis(code), cachedMonthlyUnits(code), getLiveStock([code]), cachedItemShipData(code)]);

  // 월별 출고량은 생산 기록과 무관하게 보여 준다. 교집합 조건은 생산·판매 비교 분석에만 적용
  const product = a.ok ? a.product : a.product;
  if (!product) return <p className="rounded-lg border border-dashed border-zinc-400 p-4 text-sm">품목을 찾을 수 없습니다.</p>;
  const boxSize = boxSizeOf(product.packUnit, product.unitsPerBox);

  const shipment = (
    <ShipmentSection
      period={period}
      data={unitsData}
      initialYear={year}
      scope={`${product.name} (${product.code})`}
      boxSize={boxSize}
      keepParams={{ code: product.code }}
      item={itemData}
    />
  );

  if (!a.ok) {
    const why =
      a.reason === "NO_PRODUCTION"
        ? "생산 실적이 없는 품목(사입품 등)이라 생산·판매 비교 분석(시차 상관·생산 추이)은 할 수 없습니다."
        : "정상 출고 실적이 없어 생산·판매 비교 분석을 할 수 없습니다.";
    return (
      <>
        <section className="rounded-lg border border-zinc-200 p-4">
          <Link href={`/stock/${encodeURIComponent(product.code)}`} className="block hover:underline">
            <h2 className="text-lg font-bold">{product.name}</h2>
          </Link>
          <p className="text-xs text-zinc-500">{productInfoText(product)}</p>
        </section>
        {shipment}
        <div className="rounded-lg border border-dashed border-zinc-400 p-4 text-sm" data-testid="not-analyzable">
          <p className="font-semibold">생산·판매 비교 분석 불가</p>
          <p className="mt-1 text-zinc-600">{why} 비교 분석 대상은 생산·판매 양쪽에 실적이 있는 품번뿐입니다.</p>
        </div>
      </>
    );
  }

  const { stock, days } = live.get(code)!;
  const currentMonth = seoulMonth();
  const st = stockStatus(stock, days);
  const nowRow = a.seasonal[currentMonth - 1];
  const range = a.seasonRange ? `${a.seasonRange.from}~${a.seasonRange.to}` : "자료 없음";
  const lagRange = a.lagRange ? `${a.lagRange.from}~${a.lagRange.to}` : "자료 없음";
  const returnRate = a.normalTotal > 0 ? (a.returnsTotal / a.normalTotal) * 100 : null;
  const unit = boxSize ? "박스" : "개";

  return (
    <>
      {/* 상단: 품목 + 현재 재고 + 지금 시기 해석 */}
      <section className={`rounded-lg border p-4 ${st.cardClass}`}>
        <Link href={`/stock/${encodeURIComponent(a.product.code)}`} className="block hover:underline">
          <h2 className="text-lg font-bold">{a.product.name}</h2>
        </Link>
        <p className="text-xs text-zinc-500">{productInfoText(a.product)}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-zinc-500">현재 재고</p>
            <p className={`num text-5xl font-bold leading-none ${st.numClass}`}>
              {availableText(stock)}
              {stock.available !== null && <span className="ml-1 text-base font-normal text-zinc-500">박스</span>}
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={st} />
            <p className="num mt-1 text-sm">
              예상 소진 <b>{daysText(days)}</b>
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-sm font-medium">{describeNow(nowRow.index, currentMonth, days.days)}</p>
        <p className="mt-1 text-xs text-zinc-500">재고·소진일수는 재고 관리 기준(정상·내수), 아래 분석은 정상 출고 전체 기준입니다.</p>
      </section>

      {shipment}

      {/* 생산·판매 비교 (교집합 분석) */}
      <section>
        <ChartHead title={`최근 ${TREND_MONTHS}개월 생산·판매 비교`} unit={unit} basis={`${a.trend[0]?.yearMonth}~${a.trend.at(-1)?.yearMonth} · 연도 버튼과 무관`} />
        <PickChart testid="trend-chart" {...trendView(a.trend, boxSize)} yUnit={unit} hideXTicks series={[{ name: "생산", color: COLOR_PRODUCTION, kind: "line" }, { name: "정상 출고", color: COLOR_SHIPMENT, kind: "line" }]} />
        <p className="text-xs text-zinc-500">
          생산 = A급, 본가공입고 + 재가공입고 (재가공투입 제외). 판매 = 정상 출고. 둘 다 낱개 수량{boxSize ? `을 1박스 ${boxSize}개로 나눠 박스로 표시` : " 그대로"}.
        </p>
        <div className="mt-2" data-testid="returns">
          <ChartHead title="월별 반품 (판매와 별도)" unit={unit} basis={`${a.trend[0]?.yearMonth}~${a.trend.at(-1)?.yearMonth}`} />
          <PickChart testid="returns-chart" {...returnsView(a.trend, boxSize)} yUnit={unit} hideXTicks height={140} series={[{ name: "반품", color: "#a1a1aa", kind: "bar" }]} />
          <p className="num text-sm text-zinc-700">
            {TREND_MONTHS}개월 반품 {formatUnits(a.returnsTotal, boxSize)}
            {returnRate !== null && ` — 정상 판매 ${formatUnits(a.normalTotal, boxSize)}의 ${returnRate.toFixed(1)}%`}
          </p>
        </div>
      </section>

      {/* 5년 평균 계절지수 */}
      <section>
        <ChartHead title="계절지수 — 5년 평균 (월 평균 판매 ÷ 전체 월평균)" unit="지수 (1.0 = 평균)" basis={`분석 기간 ${range} · 연도 버튼과 무관`} />
        <PickChart
          testid="season-chart"
          {...seasonAvgView(a.seasonal, "박스", PEAK_INDEX)}
          yUnit="평소 대비 (배)"
          yFormat="index"
          initialSelected={currentMonth - 1}
          series={[{ name: "평소 대비", color: COLOR_PRODUCTION, kind: "bar" }]}
        />
        <p className="text-sm text-zinc-700">{describeSeason(a.seasonal)}</p>
      </section>

      {/* 연도별 계절지수 히트맵 */}
      <section data-testid="year-heatmap">
        <ChartHead title="연도별 계절지수 (해당 월 판매 ÷ 그 해 월평균)" unit="지수 (기준 1)" basis={`분석 기간 ${range} · 연도 버튼과 무관`} />
        <YearHeatmap rows={a.yearly} />
        <p className="mt-1 text-sm text-zinc-700">{describeYearly(a.yearly)}</p>
        <p className="text-xs text-zinc-500">
          그 해 월평균은 자료 범위 안의 달만으로 냅니다(부분 연도는 12로 나누지 않음). 범위 안의 빈 달은 실제 0, 범위 밖은 자료 없음. 그 해 판매가 0이면 지수를 내지
          않습니다.
        </p>
      </section>

      {/* 시차 상관 */}
      <section>
        <ChartHead title={`생산 → 판매 시차 상관 (k = 0~${MAX_LAG})`} unit="상관계수 r (−1~1)" basis={`분석 기간 ${lagRange} · 연도 버튼과 무관`} />
        <p className="text-xs font-medium text-zinc-700">방향: 생산월 t 와 판매월 t+k 의 상관 — 월별 합계가 함께 움직이는 정도 (개별 로트의 출고 시점은 아님)</p>
        <LagChart rows={a.lags} best={a.best?.lag ?? null} />
        <LagTable rows={a.lags} best={a.best?.lag ?? null} />
        <p className="mt-1 text-sm font-medium text-zinc-800">{describeLagCalendar(a.best)}</p>
        <p className="text-xs text-zinc-500">쌍 = 생산월과 판매월이 모두 자료 범위 안인 달의 수. 쌍이 3개 미만이거나 변동이 없으면 —(산정 불가).</p>
      </section>
    </>
  );
}

async function Overview({ period, year }: { period: PeriodData; year: YearChoice; link?: (p: Record<string, string | undefined>) => string }) {
  const [o, unitsData] = await Promise.all([cachedOverview(), cachedMonthlyUnits(null)]);
  const live = await getLiveStock(o.top.map((t) => t.code));
  const ctx = contextOf(period);
  const units = unitsOf(unitsData);

  // 연×월 히트맵: 전체 거래처 정상 출고(낱개). 집계 완료 달만 값, 나머지는 자료 없음
  const pts = allSeries(units.normal, ctx);
  const yearly = yearlySeasonal(
    pts.map((p) => p.ym),
    pts.map((p) => p.units),
  );
  const okPts = pts.filter((p) => p.units !== null);
  const seasonal = seasonalIndex(
    okPts.map((p) => p.ym),
    okPts.map((p) => p.units as number),
  );
  const heatRange = okPts.length ? `${okPts[0].ym}~${okPts.at(-1)!.ym}` : "자료 없음";
  const lagRange = o.lagRange ? `${o.lagRange.from}~${o.lagRange.to}` : "자료 없음";
  const range = o.seasonRange ? `${o.seasonRange.from}~${o.seasonRange.to}` : "자료 없음";

  const asOf = `데이터 기준일 ${o.basis.shipmentTo ?? "없음"}`;
  return (
    <div className="flex flex-col gap-10">
      <Section id="monthly" question="매달 얼마나 출고했나?" meta={`선택 연도 기준 · 단위 개(낱개) · ${asOf}`}>
        <ShipmentSection period={period} data={unitsData} initialYear={year} scope="전체 거래처" boxSize={null} />
      </Section>

      <Section
        id="season"
        question="어느 달에 평소보다 많이 출고됐나?"
        meta={`분석 기간 ${heatRange} · 단위 개(낱개), 그해 월평균 대비 % · ${asOf}`}
        answer={`${describeYearly(yearly)} ${describeSeason(seasonal)}`}
      >
      <section data-testid="year-heatmap">
        <YearHeatmap rows={yearly} unit="개" testid="season-heatmap" />
      </section>
      </Section>

      <Section
        id="lag"
        question="생산이 많았던 달에는 출고도 많았을까?"
        meta={`분석 기간 ${lagRange} · 생산·출고 모두 있는 ${o.intersection.toLocaleString()}품번 월별 합계(박스) · 생산 기준일 ${o.basis.productionTo ?? "없음"}`}
        answer={describeLagCalendar(o.totalBest)}
      >
      <section>
        <p className="text-xs font-medium text-zinc-700">방향: 생산월 t 와 판매월 t+k. 생산·판매를 함께 비교하므로 양쪽 실적이 있는 품번만 합산.</p>
        <LagChart rows={o.totalLags} best={o.totalBest?.lag ?? null} />
        <LagTable rows={o.totalLags} best={o.totalBest?.lag ?? null} />
      </section>
      </Section>

      <Section
        id="top"
        question="특정 달에 출고가 몰리는 품목은?"
        meta={`분석 기간 ${range} · 출고 있는 달 ${MIN_ACTIVE_MONTHS}개 이상인 ${o.eligible.toLocaleString()}품목 중 · 단위 품목 포장 단위 · ${asOf}`}
        answer={
          o.top.length
            ? `${o.top[0].name}은(는) ${o.top[0].peakMonth}월 출고가 평소 월평균의 ${o.top[0].peakIndex.toFixed(1)}배 — 집중도가 가장 큽니다.`
            : "조건을 만족하는 품목이 없습니다."
        }
      >
        <p className="text-xs text-zinc-500">
          정렬: 5년 평균으로 본 가장 많은 달(집중된 달)이 평소(분석 기간 전체 월평균)의 몇 배인지 큰 순. 같은 달이 여러 해 반복됐는지, 한 해 대량 출고 때문인지는 &ldquo;근거 보기&rdquo;.
        </p>
        {o.top.length > 0 && (
          <TopTable
            rows={o.top.map((r) => {
              const { stock, days } = live.get(r.code)!;
              return { code: r.code, name: r.name, peakMonth: r.peakMonth, peakIndex: r.peakIndex, unitLabel: r.unitLabel, evidence: r.evidence, stock: stockCell(r.code, stock, days) };
            })}
          />
        )}
      </Section>
    </div>
  );
}
