import CustomerTimeline from "@/components/CustomerTimeline";
import { cachedPeriodData } from "@/lib/analytics/cached";
import { getCustomerTimeline, getCustomerTop, topPeriods } from "@/lib/analytics/customerTop";
import { contextOf } from "@/lib/analytics/shipments";
import { getCustomerEvents } from "@/lib/events/query";
import { pinState } from "@/lib/pin";
import Link from "next/link";

export const metadata = { title: "거래선 TOP 10" };
export const dynamic = "force-dynamic";

const n = (v: number) => Math.round(v).toLocaleString("ko-KR");

/** 기간 선택 → 거래선 정상 출고량 TOP 10 → 거래선을 누르면 주력 제품별 월별 출고 + 탐지된 변화 */
export default async function CustomerTopPage({ searchParams }: { searchParams: Promise<{ p?: string; c?: string }> }) {
  const sp = await searchParams;
  const ctx = contextOf(await cachedPeriodData());
  const periods = topPeriods(ctx);
  const period = periods.find((x) => x.key === sp.p) ?? periods[0];
  if (!period) return <main className="p-4 text-sm">출고 자료가 없습니다.</main>;
  const [top, pin] = await Promise.all([getCustomerTop(period, ctx), pinState()]);
  const selected = sp.c && top.rows.some((r) => r.customer === sp.c) ? sp.c : null;
  const [timeline, events] = selected ? await Promise.all([getCustomerTimeline(selected, period, ctx), getCustomerEvents(selected)]) : [null, []];
  const link = (p: string, c?: string) => `/analytics/customers?${new URLSearchParams({ p, ...(c ? { c } : {}) })}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 lg:max-w-5xl lg:px-8">
      <Link href="/analytics" className="text-sm text-blue-600">
        ← 분석
      </Link>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h1 className="text-xl font-bold">어느 거래선이 많이 가져갔나? — 거래선 TOP 10</h1>
        <span className="num text-xs text-zinc-500" data-testid="top-meta">
          {period.from}~{period.to} · 정상 출고 · 단위 개(낱개) · 집계 완료 {ctx.completeThrough}까지
        </span>
      </div>
      <nav className="flex flex-wrap gap-1" aria-label="기간 선택" data-testid="top-periods">
        {periods.map((x) => (
          <Link
            key={x.key}
            href={link(x.key)}
            aria-current={x.key === period.key ? "page" : undefined}
            className={`num flex h-10 items-center rounded-md border px-3 text-sm ${x.key === period.key ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-zinc-300 text-zinc-700 hover:bg-blue-50"}`}
          >
            {x.label}
          </Link>
        ))}
      </nav>
      <p className="text-sm font-medium text-zinc-800" data-testid="top-answer">
        상위 10곳이 기간 정상 출고의 {Math.round(top.rows.reduce((s, r) => s + r.share, 0) * 100)}% ({n(top.rows.reduce((s, r) => s + r.units, 0))}개 / 전체 {n(top.total)}개)
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="num w-full text-sm" data-testid="customer-top">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="w-10 px-2 py-2 text-right font-medium">순위</th>
              <th className="px-2 py-2 text-left font-medium">거래선</th>
              <th className="px-2 py-2 text-right font-medium">출고량</th>
              <th className="w-14 px-2 py-2 text-right font-medium">비중</th>
              <th className="w-20 px-2 py-2 text-right font-medium">전년 대비</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {top.rows.map((r) => (
              <tr key={r.customer} className={r.customer === selected ? "bg-blue-50" : "hover:bg-blue-50/50"} data-testid="customer-top-row">
                <td className="px-2 py-0 text-right">{r.rank}</td>
                <td className="px-2 py-0">
                  <Link href={link(period.key, r.customer === selected ? undefined : r.customer)} className="block min-h-11 py-3 font-medium text-zinc-900 underline-offset-2 hover:underline" scroll={false}>
                    {r.customer}
                  </Link>
                </td>
                <td className="px-2 py-0 text-right">{n(r.units)}</td>
                <td className="px-2 py-0 text-right">{(r.share * 100).toFixed(1)}%</td>
                <td className={`px-2 py-0 text-right ${r.yoy === null ? "text-zinc-400" : r.yoy >= 0 ? "text-blue-800" : "text-orange-700"}`}>
                  {r.yoy === null ? (r.prev === 0 ? "전년 0" : "—") : `${r.yoy >= 0 ? "+" : "−"}${Math.abs(Math.round(r.yoy))}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        전년 대비 = 같은 달들의 전년 정상 출고와 비교{top.prevComparable ? "" : " — 전년 같은 달 자료가 완전하지 않아 비교하지 않음"}. 거래선 유형(B2B/B2C)은 회사 분류표 전까지 쓰지 않습니다.
      </p>
      {selected && timeline && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4" data-testid="customer-detail">
          <h2 className="text-lg font-bold">{selected} — 주력 제품별 월별 출고</h2>
          <CustomerTimeline data={timeline} events={events} canNote={pin === "OK"} />
        </section>
      )}
    </main>
  );
}
