import EventList from "@/components/EventList";
import { KIND_LABEL } from "@/lib/events/describe";
import { EVENTS_PAGE, getRunInfo, searchGroups } from "@/lib/events/query";
import { formatDateTime } from "@/lib/format";
import { pinState } from "@/lib/pin";
import Link from "next/link";

export const metadata = { title: "주목할 변화 전체 보기" };
export const dynamic = "force-dynamic";

type SP = { from?: string; to?: string; customer?: string; product?: string; kind?: string; page?: string };

/** 전체 탐지 결과 — 기간·거래처·품목·변화 유형으로 찾기 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [run, pin] = await Promise.all([getRunInfo(), pinState()]);
  const result = run ? await searchGroups({ from: sp.from, to: sp.to, customer: sp.customer?.trim(), product: sp.product?.trim(), kind: sp.kind, page }) : { total: 0, groups: [] };
  const pages = Math.max(1, Math.ceil(result.total / EVENTS_PAGE));
  const qs = (p: number) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(p) } as Record<string, string>)}`;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 lg:max-w-5xl lg:px-8">
      <Link href="/analytics" className="text-sm text-blue-600">
        ← 분석
      </Link>
      <h1 className="text-xl font-bold">주목할 변화 — 전체 보기</h1>
      {run && (
        <p className="num text-xs text-zinc-500" data-testid="events-basis">
          출고 자료 {run.firstMonth}~{run.completeThrough}(집계 완료) · 탐지 {formatDateTime(new Date(run.ranAt))} · 전사·거래처·품목·거래처×품목을 월 단위로, 전사·상위 거래처를 주 단위로 검사 · 실무 최소량 월{" "}
          {Math.round(run.materiality).toLocaleString()}개 {run.missingMonths.length ? `· 자료 누락 달 ${run.missingMonths.join(", ")} 제외` : ""}
        </p>
      )}
      <form action="/analytics/events" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">시작 월</span>
          <input type="month" name="from" defaultValue={sp.from} className="h-11 rounded-md border border-zinc-300 px-2" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">끝 월</span>
          <input type="month" name="to" defaultValue={sp.to} className="h-11 rounded-md border border-zinc-300 px-2" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">거래처</span>
          <input name="customer" defaultValue={sp.customer} placeholder="거래처명" className="h-11 rounded-md border border-zinc-300 px-2" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">품목</span>
          <input name="product" defaultValue={sp.product} placeholder="품명·품번" className="h-11 rounded-md border border-zinc-300 px-2" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-xs text-zinc-500">변화 유형</span>
          <select name="kind" defaultValue={sp.kind ?? ""} className="h-11 rounded-md border border-zinc-300 px-2" aria-label="변화 유형">
            <option value="">전체</option>
            <option value="SPIKE,DROP">유난히 많음·적음</option>
            <option value="STOP,RESUME">끊김·재개</option>
            <option value="TREND_UP,TREND_DOWN">계속 증가·감소</option>
            <option value="SEASON_UP,SEASON_DOWN">해마다 같은 달 반복</option>
          </select>
        </label>
        <button type="submit" className="h-11 self-end rounded-md bg-blue-600 font-semibold text-white">
          찾기
        </button>
      </form>
      <p className="num text-sm text-zinc-600" data-testid="events-total">
        {result.total.toLocaleString()}건 · 영향(실제 증감 수량) 큰 순
        {sp.kind && ` · 유형 ${sp.kind.split(",").map((k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k).join("·")}`}
      </p>
      {!run ? (
        <p className="rounded-lg border border-dashed border-zinc-400 p-3 text-sm text-zinc-600">아직 변동 탐지를 계산하지 않았습니다.</p>
      ) : (
        <EventList groups={result.groups} canNote={pin === "OK"} testid="events-list" />
      )}
      {pages > 1 && (
        <nav className="num flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="flex h-11 items-center rounded-md border border-zinc-300 px-3">← 이전</Link> : <span />}
          <span className="text-zinc-500">
            {page} / {pages}
          </span>
          {page < pages ? <Link href={qs(page + 1)} className="flex h-11 items-center rounded-md border border-zinc-300 px-3">다음 →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
