import StockCard from "@/components/StockCard";
import { LOW_DAYS_THRESHOLD } from "@/config/stock";
import { getStockBasis, LIST_PAGE_SIZE, listByFilter, listLowStock, type ListFilter, type StockRow } from "@/lib/stock";
import { BasisLine } from "@/lib/stockDisplay";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const TITLES: Record<ListFilter | "low", string> = {
  all: "관리 대상 전체",
  checked: "확인됨 — 이번 기준재고에 있는 품목",
  unchecked: "미확인 — 최근 재고 파일에 없어 확인 필요",
  low: `곧 소진 — 확인된 품목 중 예상 소진 ${LOW_DAYS_THRESHOLD}일 이하`,
};

/** 대시보드 숫자의 상세 목록. 검색어(q)가 오면 첫 화면 검색으로 보낸다 */
export default async function StockListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string; unchecked?: string; checked?: string; all?: string; page?: string }>;
}) {
  const sp = await searchParams;
  if (sp.q?.trim()) redirect(`/?q=${encodeURIComponent(sp.q.trim())}`);
  const mode: ListFilter | "low" = sp.low === "1" ? "low" : sp.unchecked === "1" ? "unchecked" : sp.checked === "1" ? "checked" : "all";
  const page = Math.max(1, Number(sp.page) || 1);

  const basis = await getStockBasis();
  let rows: StockRow[];
  let total: number;
  if (mode === "low") {
    rows = await listLowStock();
    total = rows.length;
  } else {
    ({ rows, total } = await listByFilter(mode, page));
  }
  const pages = mode === "low" ? 1 : Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
  const qs = (p: number) => `/stock?${mode === "all" ? "all" : mode}=1&page=${p}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4">
      <Link href="/" className="text-sm text-blue-600">
        ← 재고 검색
      </Link>
      <header>
        <h1 className="text-lg font-bold">{TITLES[mode]}</h1>
        <p className="num text-sm text-zinc-600">{total.toLocaleString()}개 품목</p>
        <BasisLine basis={basis} />
      </header>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-4 text-center text-sm text-zinc-500">해당 품목이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <StockCard key={r.code} row={r} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav className="num flex items-center justify-between pt-2 text-sm" aria-label="페이지">
          {page > 1 ? (
            <Link href={qs(page - 1)} className="flex h-12 items-center rounded-lg border border-zinc-300 px-4 hover:bg-blue-50">
              ← 이전
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={qs(page + 1)} className="flex h-12 items-center rounded-lg border border-zinc-300 px-4 hover:bg-blue-50">
              다음 →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
