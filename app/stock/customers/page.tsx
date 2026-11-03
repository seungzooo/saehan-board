import { customerPeriod, searchCustomers } from "@/lib/customers";
import Link from "next/link";

export const metadata = { title: "거래처로 찾기" };

/** 재고 메뉴 → 거래처 검색 */
export default async function CustomerSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const period = await customerPeriod();
  const hits = q.trim() ? await searchCustomers(q, period) : [];
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4">
      <Link href="/" className="text-sm text-blue-600">
        ← 재고 검색
      </Link>
      <h1 className="text-lg font-bold">거래처로 찾기</h1>
      <form action="/stock/customers" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="거래처명"
          aria-label="거래처 검색"
          autoComplete="off"
          className="h-14 min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 text-base outline-none focus:border-blue-600"
        />
        <button type="submit" className="h-14 shrink-0 rounded-lg bg-blue-600 px-5 text-base font-semibold text-white">
          찾기
        </button>
      </form>
      {period && (
        <p data-testid="customer-period" className="num text-xs text-zinc-500">
          출고 건수 기간: {period.fromYm} ~ {period.toYm} ({period.basis === "complete" ? "집계 완료 마지막 달 기준" : "집계 완료 월 미정 — 자료가 있는 마지막 달 기준"}) · 정상 출고
        </p>
      )}
      {q.trim() &&
        (hits.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 p-4 text-center text-sm text-zinc-500">&ldquo;{q.trim()}&rdquo; — 일치하는 거래처가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
            {hits.map((c) => (
              <li key={c.code}>
                <Link
                  href={`/stock/customers/${encodeURIComponent(c.code)}`}
                  data-testid="customer-hit"
                  className="flex min-h-12 items-center justify-between gap-2 px-4 py-3 hover:bg-blue-50"
                >
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <span className="num shrink-0 text-xs text-zinc-500">최근 12개월 출고 {c.shipments.toLocaleString()}회</span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}
