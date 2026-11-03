import { ChartHead, LagChart, ReturnsChart, SeasonChart, TotalChart, TrendChart } from "@/components/charts";
import YearHeatmap from "@/components/YearHeatmap";
import {
  describeLagCalendar,
  describeNow,
  describeSeason,
  describeTrend,
  describeYearly,
  PEAK_INDEX,
  type LagRow,
} from "@/lib/analytics/seasonal";
import {
  getAnalysisBasis,
  getOverview,
  getProductAnalysis,
  MAX_LAG,
  searchAnalysisProducts,
  SEGMENT_LABEL,
  TREND_MONTHS,
  type AnalysisBasis,
  type Segment,
} from "@/lib/analytics/query";
import { availableText, daysText, productInfoText, StatusBadge, stockStatus } from "@/lib/stockDisplay";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * F5 분석 — 이사님 문제 ①: 생산·판매 상관관계, 시기별·계절별 패턴.
 * 판매 = 정상 출고(판매형태 전체), 반품은 따로. 재고 관리용 내수 필터는 쓰지 않는다.
 */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ code?: string; q?: string; seg?: string }> }) {
  const sp = await searchParams;
  const seg: Segment = sp.seg === "B2B" || sp.seg === "B2C" ? sp.seg : "ALL";
  const basis = await getAnalysisBasis();
  const q = sp.q?.trim() ?? "";
  const link = (params: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ seg: seg === "ALL" ? undefined : seg, ...params })) if (v) u.set(k, v);
    const s = u.toString();
    return `/analytics${s ? `?${s}` : ""}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-xl font-bold">생산·판매 분석</h1>
          {sp.code && (
            <Link href={link({})} className="text-sm text-blue-600">
              전체 요약
            </Link>
          )}
        </div>
        <BasisNote basis={basis} />

        <form action="/analytics" className="flex gap-2">
          {seg !== "ALL" && <input type="hidden" name="seg" value={seg} />}
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

        <nav className="flex flex-wrap gap-1 text-sm" aria-label="거래선 구분">
          {(["ALL", "B2B", "B2C"] as const).map((s) => (
            <Link
              key={s}
              href={`/analytics?${new URLSearchParams({ ...(s !== "ALL" ? { seg: s } : {}), ...(sp.code ? { code: sp.code } : {}), ...(q ? { q } : {}) })}`}
              className={`flex h-10 items-center rounded-md border px-3 ${seg === s ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-zinc-300 text-zinc-700 hover:bg-blue-50"}`}
            >
              {SEGMENT_LABEL[s]}
            </Link>
          ))}
          <span className="ml-1 self-center text-xs text-zinc-500">거래처 마스터 구분 기준 정상 출고</span>
        </nav>
      </header>

      {q && !sp.code ? <SearchResults q={q} link={link} /> : sp.code ? <ProductView code={sp.code} seg={seg} /> : <Overview seg={seg} link={link} />}
    </main>
  );
}

function BasisNote({ basis }: { basis: AnalysisBasis }) {
  return (
    <p className="num text-xs text-zinc-500" data-testid="analysis-basis">
      실적 기준: 정상 출고 {basis.shipmentTo ?? "없음"} · 생산 {basis.productionTo ?? "없음"} · 자료 범위 출고{" "}
      {basis.salesCoverage ? `${basis.salesCoverage.from}~${basis.salesCoverage.to}` : "없음"} / 생산{" "}
      {basis.productionCoverage ? `${basis.productionCoverage.from}~${basis.productionCoverage.to}` : "없음"}. 판매 = 정상 출고(판매형태 전체), 반품 별도. 실적
      업로드 때마다 월별 집계 재계산.
    </p>
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
            {!p.analyzable && <span className="shrink-0 rounded border border-dashed border-zinc-400 px-1.5 py-0.5 text-xs text-zinc-600">분석 불가</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function ProductView({ code, seg }: { code: string; seg: Segment }) {
  const a = await getProductAnalysis(code, seg);
  if (!a.ok) {
    const why =
      a.reason === "NOT_FOUND"
        ? "품목을 찾을 수 없습니다."
        : a.reason === "NO_PRODUCTION"
          ? "생산 실적이 없는 품목(사입품 등)이라 생산·판매 상관분석 대상이 아닙니다."
          : "정상 출고 실적이 없어 분석할 수 없습니다.";
    return (
      <div className="rounded-lg border border-dashed border-zinc-400 p-4 text-sm" data-testid="not-analyzable">
        <p className="font-semibold">분석 불가{a.product && ` — ${a.product.name}`}</p>
        <p className="mt-1 text-zinc-600">{why} 분석 대상은 생산·판매 양쪽에 실적이 있는 품번뿐입니다.</p>
        {a.product && (
          <Link href={`/stock/${encodeURIComponent(a.product.code)}`} className="mt-2 inline-block text-blue-600">
            재고 보기 →
          </Link>
        )}
      </div>
    );
  }
  const st = stockStatus(a.stock, a.days);
  const nowRow = a.seasonal[a.currentMonth - 1];
  const peaks = a.seasonal.filter((r) => (r.index ?? 0) >= PEAK_INDEX).map((r) => r.month);
  const segNote = seg === "ALL" ? "" : ` · ${SEGMENT_LABEL[seg]} 거래처`;
  const range = a.seasonRange ? `${a.seasonRange.from}~${a.seasonRange.to}` : "자료 없음";
  const returnRate = a.normalTotal > 0 ? (a.returnsTotal / a.normalTotal) * 100 : null;

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
              {availableText(a.stock)}
              {a.stock.available !== null && <span className="ml-1 text-base font-normal text-zinc-500">박스</span>}
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={st} />
            <p className="num mt-1 text-sm">
              예상 소진 <b>{daysText(a.days)}</b>
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-sm font-medium">{describeNow(nowRow.index, a.currentMonth, a.days.days)}</p>
        <p className="mt-1 text-xs text-zinc-500">재고·소진일수는 재고 관리 기준(정상·내수), 아래 분석은 정상 출고 전체 기준입니다.</p>
      </section>

      {/* 월별 생산·판매 + 반품 */}
      <section>
        <ChartHead title={`최근 ${TREND_MONTHS}개월 월별 생산·판매`} unit="박스" basis={`${a.trend[0]?.yearMonth}~${a.trend.at(-1)?.yearMonth}${segNote}`} />
        <TrendChart data={a.trend} />
        <p className="text-sm text-zinc-700">{describeTrend(a.trend.map((t) => t.shipment))}</p>
        <p className="text-xs text-zinc-500">생산 = A급, 본가공입고 + 재가공입고 (재가공투입 제외). 판매 = 정상 출고. 둘 다 행마다 포장단위수량으로 나눈 박스 환산.</p>
        <div className="mt-2" data-testid="returns">
          <ChartHead title="월별 반품 (판매와 별도)" unit="박스" basis={`${TREND_MONTHS}개월`} />
          <ReturnsChart data={a.trend} />
          <p className="num text-sm text-zinc-700">
            {TREND_MONTHS}개월 반품 {Math.round(a.returnsTotal).toLocaleString()}박스
            {returnRate !== null && ` — 정상 판매 ${Math.round(a.normalTotal).toLocaleString()}박스의 ${returnRate.toFixed(1)}%`}
          </p>
        </div>
      </section>

      {/* 5년 평균 계절지수 */}
      <section>
        <ChartHead title="계절지수 — 5년 평균 (월 평균 판매 ÷ 전체 월평균)" unit="지수 (1.0 = 평균)" basis={`${range}${segNote}`} />
        <SeasonChart rows={a.seasonal} peak={PEAK_INDEX} />
        <p className="text-sm text-zinc-700">{describeSeason(a.seasonal)}</p>
        <table className="num mt-2 w-full overflow-hidden rounded-lg border border-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">월</th>
              <th className="px-3 py-2 text-right font-medium">지수</th>
              <th className="px-3 py-2 text-right font-medium">평균 판매(박스)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {a.seasonal.map((r) => {
              const peak = peaks.includes(r.month);
              return (
                <tr key={r.month} className={r.month === a.currentMonth ? "bg-blue-50" : ""}>
                  <td className="px-3 py-2">
                    {r.month}월{r.month === a.currentMonth && <span className="ml-1 text-xs text-blue-700">이번 달</span>}
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
        <ChartHead title="연도별 계절지수 (해당 월 판매 ÷ 그 해 월평균)" unit="지수 (기준 1)" basis={`${range}${segNote}`} />
        <YearHeatmap rows={a.yearly} />
        <p className="mt-1 text-sm text-zinc-700">{describeYearly(a.yearly)}</p>
        <p className="text-xs text-zinc-500">
          그 해 월평균은 자료 범위 안의 달만으로 냅니다(부분 연도는 12로 나누지 않음). 범위 안의 빈 달은 실제 0, 범위 밖은 자료 없음. 그 해 판매가 0이면 지수를 내지
          않습니다.
        </p>
      </section>

      {/* 시차 상관 */}
      <section>
        <ChartHead title={`생산 → 판매 시차 상관 (k = 0~${MAX_LAG})`} unit="상관계수 r (−1~1)" basis={`월별${segNote}`} />
        <p className="text-xs font-medium text-zinc-700">방향: 생산월 t 와 판매월 t+k 의 상관 — k개월 뒤 판매가 생산을 따라가는지</p>
        <LagChart rows={a.lags} best={a.best?.lag ?? null} />
        <LagTable rows={a.lags} best={a.best?.lag ?? null} />
        <p className="mt-1 text-sm font-medium text-zinc-800">{describeLagCalendar(a.best)}</p>
        <p className="text-xs text-zinc-500">
          쌍 = 생산월과 판매월이 모두 자료 범위 안인 달의 수. 쌍이 3개 미만이거나 변동이 없으면 —(산정 불가).
        </p>
      </section>
    </>
  );
}

async function Overview({ seg, link }: { seg: Segment; link: (p: Record<string, string | undefined>) => string }) {
  const o = await getOverview(seg);
  const segNote = seg === "ALL" ? "" : ` · ${SEGMENT_LABEL[seg]} 거래처`;
  const range = o.seasonRange ? `${o.seasonRange.from}~${o.seasonRange.to}` : "자료 없음";
  const returnRate = o.normalTotal > 0 ? (o.returnsTotal / o.normalTotal) * 100 : null;
  return (
    <>
      <section>
        <ChartHead title="전체 월별 판매 추이 (정상 출고)" unit="박스" basis={`${range} · 생산·판매 교집합 ${o.intersection.toLocaleString()}품번${segNote}`} />
        <TotalChart data={o.totalSeries} />
        <p className="text-sm text-zinc-700">
          {describeSeason(o.totalSeasonal)} · {describeTrend(o.totalSeries.map((t) => t.shipment))}
        </p>
        <p className="num text-sm text-zinc-700" data-testid="returns">
          같은 기간 반품 {o.returnsTotal.toLocaleString()}박스{returnRate !== null && ` — 정상 판매의 ${returnRate.toFixed(1)}%`}
        </p>
      </section>

      <section data-testid="year-heatmap">
        <ChartHead title="연도별 계절지수 — 교집합 전체" unit="지수 (기준 1)" basis={`${range}${segNote}`} />
        <YearHeatmap rows={o.totalYearly} />
        <p className="mt-1 text-sm text-zinc-700">{describeYearly(o.totalYearly)}</p>
      </section>

      <section>
        <ChartHead title={`생산 → 판매 시차 상관 — 교집합 전체 (k = 0~${MAX_LAG})`} unit="상관계수 r" basis={`월별 합계${segNote}`} />
        <p className="text-xs font-medium text-zinc-700">방향: 생산월 t 와 판매월 t+k</p>
        <LagChart rows={o.totalLags} best={o.totalBest?.lag ?? null} />
        <LagTable rows={o.totalLags} best={o.totalBest?.lag ?? null} />
        <p className="mt-1 text-sm font-medium text-zinc-800">{describeLagCalendar(o.totalBest)}</p>
      </section>

      <section>
        <ChartHead title="계절지수 상위 10 품목 (성수기 편차 큰 순)" unit="지수 · 박스" basis={`5년 중 판매 24개월 이상인 ${o.eligible.toLocaleString()}품목 중`} />
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
                  const st = stockStatus(r.stock, r.days);
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
                          {availableText(r.stock)}
                        </Link>
                      </td>
                      <td className="px-2 py-0 text-right text-xs">
                        <Link href={`/stock/${encodeURIComponent(r.code)}`} className="block py-3">
                          {daysText(r.days)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {o.top[0] && (
          <p className="mt-1 text-sm text-zinc-700">
            {o.top[0].name}은(는) {o.top[0].peakMonth}월 판매가 평균의 {o.top[0].peakIndex.toFixed(1)}배 — 성수기 전에 재고를 확인하세요.
          </p>
        )}
      </section>
    </>
  );
}
