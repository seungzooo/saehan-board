import { ChartHead, LagChart, ReturnsChart, SeasonChart, TrendChart } from "@/components/charts";
import YearHeatmap from "@/components/YearHeatmap";
import { cachedAnalysisBasis, cachedCompletionInfo, cachedMonthlyUnits, cachedOverview, cachedPeriodData, cachedProductAnalysis } from "@/lib/analytics/cached";
import { allSeries, boxSizeOf, formatUnits, parseYear, type PeriodContext, type YearChoice } from "@/lib/analytics/periods";
import { getLiveStock, MAX_LAG, searchAnalysisProducts, seoulMonth, TREND_MONTHS, type AnalysisBasis } from "@/lib/analytics/query";
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
import ShipmentSection from "./ShipmentSection";

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
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-4">
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
  const [a, unitsData, live] = await Promise.all([cachedProductAnalysis(code), cachedMonthlyUnits(code), getLiveStock([code])]);

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
  const peaks = a.seasonal.filter((r) => (r.index ?? 0) >= PEAK_INDEX).map((r) => r.month);
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
        <TrendChart data={a.trend} boxSize={boxSize} />
        <p className="text-xs text-zinc-500">
          생산 = A급, 본가공입고 + 재가공입고 (재가공투입 제외). 판매 = 정상 출고. 둘 다 낱개 수량{boxSize ? `을 1박스 ${boxSize}개로 나눠 박스로 표시` : " 그대로"}.
        </p>
        <div className="mt-2" data-testid="returns">
          <ChartHead title="월별 반품 (판매와 별도)" unit={unit} basis={`${a.trend[0]?.yearMonth}~${a.trend.at(-1)?.yearMonth}`} />
          <ReturnsChart data={a.trend} boxSize={boxSize} />
          <p className="num text-sm text-zinc-700">
            {TREND_MONTHS}개월 반품 {formatUnits(a.returnsTotal, boxSize)}
            {returnRate !== null && ` — 정상 판매 ${formatUnits(a.normalTotal, boxSize)}의 ${returnRate.toFixed(1)}%`}
          </p>
        </div>
      </section>

      {/* 5년 평균 계절지수 */}
      <section>
        <ChartHead title="계절지수 — 5년 평균 (월 평균 판매 ÷ 전체 월평균)" unit="지수 (1.0 = 평균)" basis={`분석 기간 ${range} · 연도 버튼과 무관`} />
        <SeasonChart rows={a.seasonal} peak={PEAK_INDEX} />
        <p className="text-sm text-zinc-700">{describeSeason(a.seasonal)}</p>
        <table className="num mt-2 w-full overflow-hidden rounded-lg border border-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">월</th>
              <th className="px-3 py-2 text-right font-medium">지수</th>
              <th className="px-3 py-2 text-right font-medium">평균 판매(박스 환산)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {a.seasonal.map((r) => {
              const peak = peaks.includes(r.month);
              return (
                <tr key={r.month} className={r.month === currentMonth ? "bg-blue-50" : ""}>
                  <td className="px-3 py-2">
                    {r.month}월{r.month === currentMonth && <span className="ml-1 text-xs text-blue-700">이번 달</span>}
                  </td>
                  <td className={`px-3 py-2 text-right ${peak ? "font-bold text-blue-800" : ""}`}>
                    {r.index === null ? "—" : r.index.toFixed(2)}
                    {peak && <span className="ml-1 text-xs">성수기</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{Math.round(r.avg).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
        <p className="text-xs font-medium text-zinc-700">방향: 생산월 t 와 판매월 t+k 의 상관 — k개월 뒤 판매가 생산을 따라가는지</p>
        <LagChart rows={a.lags} best={a.best?.lag ?? null} />
        <LagTable rows={a.lags} best={a.best?.lag ?? null} />
        <p className="mt-1 text-sm font-medium text-zinc-800">{describeLagCalendar(a.best)}</p>
        <p className="text-xs text-zinc-500">쌍 = 생산월과 판매월이 모두 자료 범위 안인 달의 수. 쌍이 3개 미만이거나 변동이 없으면 —(산정 불가).</p>
      </section>
    </>
  );
}

async function Overview({ period, year, link }: { period: PeriodData; year: YearChoice; link: (p: Record<string, string | undefined>) => string }) {
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

  return (
    <>
      <ShipmentSection period={period} data={unitsData} initialYear={year} scope="전체 거래처" boxSize={null} />

      <section data-testid="year-heatmap">
        <ChartHead title="연도별 계절지수 — 전체 거래처 정상 출고" unit="지수 (기준 1)" basis={`분석 기간 ${heatRange} · 연도 버튼과 무관`} />
        <YearHeatmap rows={yearly} unit="개" />
        <p className="mt-1 text-sm text-zinc-700">
          {describeYearly(yearly)} {describeSeason(seasonal)}
        </p>
      </section>

      <section>
        <ChartHead
          title={`생산 → 판매 시차 상관 — 교집합 ${o.intersection.toLocaleString()}품번 (k = 0~${MAX_LAG})`}
          unit="상관계수 r"
          basis={`분석 기간 ${lagRange} · 월별 합계 · 연도 버튼과 무관`}
        />
        <p className="text-xs font-medium text-zinc-700">방향: 생산월 t 와 판매월 t+k. 생산·판매를 함께 비교하므로 양쪽 실적이 있는 품번만 합산.</p>
        <LagChart rows={o.totalLags} best={o.totalBest?.lag ?? null} />
        <LagTable rows={o.totalLags} best={o.totalBest?.lag ?? null} />
        <p className="mt-1 text-sm font-medium text-zinc-800">{describeLagCalendar(o.totalBest)}</p>
      </section>

      <section>
        <ChartHead
          title="계절지수 상위 10 품목 (성수기 편차 큰 순)"
          unit="지수"
          basis={`분석 기간 ${range} · 판매 24개월 이상인 ${o.eligible.toLocaleString()}품목 중 · 연도 버튼과 무관`}
        />
        {o.top.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">조건을 만족하는 품목이 없습니다.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <table className="num w-full table-fixed text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">품명</th>
                  <th className="w-12 px-2 py-2 text-right font-medium">최고 월</th>
                  <th className="w-12 px-2 py-2 text-right font-medium">지수</th>
                  <th className="w-[4.5rem] px-2 py-2 text-right font-medium">현재 재고</th>
                  <th className="w-14 px-2 py-2 text-right font-medium">소진</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {o.top.map((r) => {
                  const href = link({ code: r.code });
                  const { stock, days } = live.get(r.code)!;
                  const st = stockStatus(stock, days);
                  return (
                    <tr key={r.code} className="hover:bg-blue-50">
                      <td className="truncate px-2 py-0">
                        <Link href={href} className="block py-3">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-2 py-0 text-right">
                        <Link href={href} className="block py-3">
                          {r.peakMonth}월
                        </Link>
                      </td>
                      <td className="px-2 py-0 text-right font-semibold text-blue-800">
                        <Link href={href} className="block py-3">
                          {r.peakIndex.toFixed(2)}
                        </Link>
                      </td>
                      <td className={`px-2 py-0 text-right ${st.numClass}`}>
                        <Link href={`/stock/${encodeURIComponent(r.code)}`} className="block py-3 text-xs">
                          {availableText(stock)}
                        </Link>
                      </td>
                      <td className="px-2 py-0 text-right text-xs">
                        <Link href={`/stock/${encodeURIComponent(r.code)}`} className="block py-3">
                          {daysText(days)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
