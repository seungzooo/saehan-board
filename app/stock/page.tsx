import ListControls from "@/components/ListControls";
import StockListRow from "@/components/StockListRow";
import { LIST_PAGE_SIZE, LOW_DAYS_THRESHOLD, RECENT_QTY_MONTHS } from "@/config/stock";
import { getStockUniverse } from "@/lib/activity";
import { buildList, type ListView } from "@/lib/managed";
import { getStockBasis } from "@/lib/stock";
import { BasisLine } from "@/lib/stockDisplay";
import PendingLink from "@/components/PendingLink";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

const VIEWS: Record<ListView, { title: string; sort: string; toggle: boolean }> = {
  all: { title: "관리 대상 전체", sort: "확인된 품목(소진일수 짧은 순) → 확인 필요(최근 출고 건수 많은 순)", toggle: true },
  checked: { title: "확인 — 이번 기준재고에 있는 품목", sort: "소진일수 짧은 순, 산정 불가는 마지막", toggle: true },
  unchecked: { title: "미확인 — 최근 재고 파일에 없음", sort: `최근 ${RECENT_QTY_MONTHS}개 달 출고 건수 많은 순 → 최근 출고일 → 품번`, toggle: true },
  low: { title: `곧 소진 — 소진 ${LOW_DAYS_THRESHOLD}일 이하`, sort: "소진일수 짧은 순", toggle: true },
  dormant: { title: "휴면 — 최근 12개 달 정상·내수 출고 없음", sort: "최근 출고일 최신 순", toggle: false },
  dormantStock: { title: "휴면이지만 재고 있음", sort: "현재 재고 많은 순", toggle: false },
};

/** 옛 주소(?unchecked=1 등)도 받는다 */
function viewOf(sp: Record<string, string | undefined>): ListView {
  if (sp.view && sp.view in VIEWS) return sp.view as ListView;
  if (sp.low === "1") return "low";
  if (sp.unchecked === "1") return "unchecked";
  if (sp.checked === "1") return "checked";
  return "all";
}

export default async function StockListPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // 예전 방식: 보기 지정 없이 q만 오면 첫 화면 검색으로
  if (sp.q?.trim() && !sp.view && !sp.low && !sp.unchecked && !sp.checked && !sp.all) redirect(`/?q=${encodeURIComponent(sp.q.trim())}`);
  const view = viewOf(sp);
  const meta = VIEWS[view];
  const includeDormant = meta.toggle && sp.dormant === "1";
  const q = sp.q ?? "";

  const [{ basis, rows }, stockBasis] = await Promise.all([getStockUniverse(), getStockBasis()]);
  const list = buildList(rows, { view, includeDormant, q, page: Number(sp.page) || 1, size: LIST_PAGE_SIZE, lowDays: LOW_DAYS_THRESHOLD });
  const pageHref = (p: number) => {
    const u = new URLSearchParams({ view });
    if (q.trim()) u.set("q", q.trim());
    if (includeDormant) u.set("dormant", "1");
    if (p > 1) u.set("page", String(p));
    return `/stock?${u}`;
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
      <Link href="/" className="text-sm text-blue-600">
        ← 홈
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold">{meta.title}</h1>
        <p className="num text-sm text-zinc-600">
          {list.total.toLocaleString()}개 품목{includeDormant && " (휴면 포함)"} · 정렬: {meta.sort}
        </p>
        {basis && (
          <p className="num text-xs text-zinc-500">
            관리 대상 기준: {basis.fromYm} ~ {basis.basisYm} 정상·내수 출고 · 최신 출고일 {basis.latestShipDate} · 출고량 단위는 품목 포장단위
          </p>
        )}
        <BasisLine basis={stockBasis} />
      </header>

      <nav className="flex flex-wrap gap-1 text-sm" aria-label="목록 종류">
        {(["all", "checked", "unchecked", "low", "dormant", "dormantStock"] as const).map((v) => (
          <PendingLink
            key={v}
            href={`/stock?view=${v}`}
            className={`flex h-10 items-center rounded-md border px-3 ${view === v ? "border-blue-600 bg-blue-600 font-semibold text-white" : "border-zinc-300 text-zinc-700 hover:bg-blue-50"}`}
          >
            {{ all: "관리 대상", checked: "확인", unchecked: "미확인", low: "곧 소진", dormant: "휴면", dormantStock: "휴면·재고 있음" }[v]}
          </PendingLink>
        ))}
      </nav>

      <Suspense>
        <ListControls key={view} initialQuery={q} includeDormant={includeDormant} showToggle={meta.toggle} />
      </Suspense>

      {list.items.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-center text-sm text-zinc-500">
          {q.trim() ? `"${q.trim()}" — 일치하는 품목 없음` : "해당 품목이 없습니다."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          {list.items.map((r) => (
            <StockListRow key={r.code} row={r} lowDays={LOW_DAYS_THRESHOLD} />
          ))}
        </ul>
      )}

      {list.pages > 1 && (
        <nav className="num flex items-center justify-between pt-2 text-sm" aria-label="페이지">
          {list.page > 1 ? (
            <PendingLink href={pageHref(list.page - 1)} className="flex h-12 items-center rounded-lg border border-zinc-300 px-4 hover:bg-blue-50">
              ← 이전
            </PendingLink>
          ) : (
            <span />
          )}
          <span className="text-zinc-500">
            {list.page} / {list.pages} 페이지 · {((list.page - 1) * LIST_PAGE_SIZE + 1).toLocaleString()}–{Math.min(list.page * LIST_PAGE_SIZE, list.total).toLocaleString()}
          </span>
          {list.page < list.pages ? (
            <PendingLink href={pageHref(list.page + 1)} className="flex h-12 items-center rounded-lg border border-zinc-300 px-4 hover:bg-blue-50">
              다음 →
            </PendingLink>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
