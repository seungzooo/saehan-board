import { ChartHead, LagChart, SeasonChart, TotalChart, TrendChart } from "@/components/charts";
import { describeLag, describeNow, describeSeason, describeTrend, PEAK_INDEX } from "@/lib/analytics/seasonal";
import {
  getAnalysisBasis,
  getOverview,
  getProductAnalysis,
  searchAnalysisProducts,
  SEGMENT_LABEL,
  TREND_MONTHS,
  type Segment,
} from "@/lib/analytics/query";
import { availableText, daysText, productInfoText, StatusBadge, stockStatus } from "@/lib/stockDisplay";
import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * F5 분석 — 이사님 문제 ①: 생산·판매 상관관계, 시기별·계절별 패턴.
 * 품목 선택 → 월별 생산·출고, 계절지수, 시차 상관 + 현재 재고·소진일수와 지금 시기 해석.
 * 선택 없음 → 전체 월별 출고 + 계절지수 상위 10 품목.
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
        <p className="num text-xs text-zinc-500">
          실적 기준: 출고 {basis.shipmentTo ?? "없음"} · 생산 {basis.productionTo ?? "없음"} · 실적 업로드 때마다 월별 집계 재계산
        </p>

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

        <nav className="flex gap-1 text-sm" aria-label="거래선 구분">
          {(["ALL", "B2B", "B2C"] as const).map((s) => (
            <Link
              key={s}
              href={`/analytics?${new URLSearchParams({ ...(s !== "ALL" ? { seg: s } : {}), ...(sp.code ? { code: sp.code } : {}), ...(q ? { q } : {}) })}`}
              className={`flex h-10 items-center rounded-md border px-3 ${seg === s ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-zinc-300 text-zinc-700 hover:bg-blue-50"}`}
            >
              {SEGMENT_LABEL[s]}
            </Link>
          ))}
          <span className="ml-1 self-center text-xs text-zinc-500">거래처 마스터 구분 기준 출고</span>
        </nav>
      </header>

      {q && !sp.code ? <SearchResults q={q} link={link} /> : sp.code ? <ProductView code={sp.code} seg={seg} /> : <Overview seg={seg} link={link} />}
    </main>
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
          : "정상·내수 출고 실적이 없어 분석할 수 없습니다.";
    return (
      <div className="rounded-lg border border-dashed border-zinc-400 p-4 text-sm">
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
  const segNote = seg === "ALL" ? "" : ` · ${SEGMENT_LABEL[seg]} 거래처 출고`;

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
      </section>

      {/* 월별 생산·출고 */}
      <section>
        <ChartHead title={`최근 ${TREND_MONTHS}개월 월별 생산·출고`} unit="박스" basis={`실적 ${a.trend.at(-1)?.yearMonth}까지${segNote}`} />
        <TrendChart data={a.trend} />
        <p className="text-sm text-zinc-700">{describeTrend(a.trend.map((t) => t.shipment))}</p>
        <p className="text-xs text-zinc-500">생산 = 본가공입고 + 재가공입고 (재가공투입 제외), 박스 환산. 출고 = 정상·내수만.</p>
      </section>

      {/* 계절지수 */}
      <section>
        <ChartHead title="계절지수 (월 평균 출고 ÷ 연평균 월 출고)" unit="지수 (1.0 = 평균)" basis={`${a.seasonRange.from.slice(0, 4)}~${a.seasonRange.to.slice(0, 4)}${segNote}`} />
        <SeasonChart rows={a.seasonal} peak={PEAK_INDEX} />
        <p className="text-sm text-zinc-700">{describeSeason(a.seasonal)}</p>
        <table className="num mt-2 w-full overflow-hidden rounded-lg border border-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">월</th>
              <th className="px-3 py-2 text-right font-medium">지수</th>
              <th className="px-3 py-2 text-right font-medium">평균 출고(박스)</th>
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

      {/* 시차 상관 */}
      <section>
        <ChartHead title="생산 → 출고 시차 상관" unit="상관계수 r (−1~1)" basis={`${a.seasonRange.from.slice(0, 4)}~${a.seasonRange.to.slice(0, 4)} 월별${segNote}`} />
        <LagChart rows={a.lags} best={a.best?.lag ?? null} />
        <p className="text-sm font-medium text-zinc-800">{describeLag(a.best)}</p>
        <p className="text-xs text-zinc-500">n개월 = 이번 달 생산과 n개월 뒤 출고의 상관. 1에 가까울수록 생산 증감이 그만큼 뒤 출고 증감과 함께 움직입니다.</p>
      </section>
    </>
  );
}

async function Overview({ seg, link }: { seg: Segment; link: (p: Record<string, string | undefined>) => string }) {
  const o = await getOverview(seg);
  const segNote = seg === "ALL" ? "" : ` · ${SEGMENT_LABEL[seg]} 거래처 출고`;
  return (
    <>
      <section>
        <ChartHead
          title="전체 월별 출고 추이"
          unit="박스"
          basis={`${o.seasonRange.from.slice(0, 4)}~${o.seasonRange.to.slice(0, 4)} · 생산·판매 교집합 ${o.intersection.toLocaleString()}품번${segNote}`}
        />
        <TotalChart data={o.totalSeries} />
        <p className="text-sm text-zinc-700">
          {describeSeason(o.totalSeasonal)} · {describeTrend(o.totalSeries.map((t) => t.shipment))}
        </p>
      </section>

      <section>
        <ChartHead title="계절지수 상위 10 품목 (성수기 편차 큰 순)" unit="지수 · 박스" basis={`5년 중 출고 ${24}개월 이상인 ${o.eligible.toLocaleString()}품목 중`} />
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
        <p className="mt-1 text-sm text-zinc-700">
          {o.top[0] ? `${o.top[0].name}은(는) ${o.top[0].peakMonth}월 출고가 평균의 ${o.top[0].peakIndex.toFixed(1)}배 — 성수기 전에 재고를 확인하세요.` : ""}
        </p>
      </section>
    </>
  );
}
