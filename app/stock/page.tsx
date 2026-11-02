import { LOW_STOCK_THRESHOLD } from "@/config/stock";
import { getStockBasis, listLowStock, searchStock } from "@/lib/stock";
import { availableText, availableTone, BasisLine } from "@/lib/stockDisplay";
import Link from "next/link";
import SearchBox from "./SearchBox";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string; low?: string }> }) {
  const { q = "", low } = await searchParams;
  const lowMode = low === "1" && q.trim() === "";
  const [basis, result] = await Promise.all([
    getStockBasis(),
    lowMode ? listLowStock(LOW_STOCK_THRESHOLD).then((rows) => ({ rows, truncated: false })) : searchStock(q),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">가용재고 조회</h1>
        <BasisLine basis={basis} />
      </header>

      <SearchBox initialQuery={q} />

      {lowMode && (
        <p className="text-sm font-semibold text-red-700">
          재고 {LOW_STOCK_THRESHOLD}박스 이하 품목 {result.rows.length}개
          {result.rows.length === 0 && " — 없음"}
        </p>
      )}
      {!lowMode && q.trim() === "" ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          품목명이나 품번을 입력하세요.
          <br />
          예: <span className="font-mono">2L</span>, <span className="font-mono">식용유</span>,{" "}
          <span className="font-mono">TM00329</span>
        </p>
      ) : result.rows.length === 0 ? (
        !lowMode && <p className="py-8 text-center text-sm text-zinc-500">&ldquo;{q}&rdquo;에 해당하는 품목이 없습니다.</p>
      ) : (
        <>
          {!lowMode && (
            <p className="text-xs text-zinc-500">
              {result.rows.length}개 품목{result.truncated && " (상위 50개만 표시 — 검색어를 더 구체적으로)"}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {result.rows.map((r) => {
              const s = r.stock;
              const needsCheck = s.available === null;
              return (
                <li key={r.code}>
                  <Link
                    href={`/stock/${encodeURIComponent(r.code)}?q=${encodeURIComponent(q)}`}
                    className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 active:bg-zinc-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{r.name}</p>
                      <p className="mt-0.5 truncate text-xs text-zinc-500">
                        <span className="font-mono">{r.code}</span>
                        {r.capacity && ` · ${r.capacity}`} · {r.packUnit} {r.unitsPerBox.toLocaleString()}개
                      </p>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {needsCheck ? "최근 재고 파일에 없음" : `기초 ${s.baseline!.toLocaleString()}`} · 오늘 차감{" "}
                        {s.todayDeduction.toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-bold tabular-nums ${needsCheck ? "text-lg" : "text-3xl"} ${availableTone(s)}`}>
                        {availableText(s)}
                      </p>
                      <p className="text-xs text-zinc-500">{needsCheck ? "" : "박스"}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}
