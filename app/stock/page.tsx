import { LOW_DAYS_THRESHOLD } from "@/config/stock";
import { getStockBasis, listLowStock, listUnchecked, searchStock, type StockRow } from "@/lib/stock";
import { availableText, availableTone, BasisLine, daysText, productInfoText } from "@/lib/stockDisplay";
import Link from "next/link";
import SearchBox from "./SearchBox";

export const dynamic = "force-dynamic";

type Mode = "search" | "low" | "unchecked";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string; unchecked?: string }>;
}) {
  const { q = "", low, unchecked } = await searchParams;
  const mode: Mode = q.trim() ? "search" : low === "1" ? "low" : unchecked === "1" ? "unchecked" : "search";

  const basis = await getStockBasis();
  let rows: StockRow[] = [];
  let truncated = false;
  let uncheckedTotal = 0;
  let uncheckedRows: { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category: string | null }[] = [];
  if (mode === "search") ({ rows, truncated } = await searchStock(q));
  else if (mode === "low") rows = await listLowStock();
  else ({ rows: uncheckedRows, total: uncheckedTotal } = await listUnchecked(200));
  const basisTo = rows[0]?.days.basisTo ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">가용재고 조회</h1>
        <BasisLine basis={basis} />
      </header>

      <SearchBox initialQuery={q} />

      {mode === "low" && (
        <p className="text-sm font-semibold text-red-700">
          확인된 품목 중 예상 소진 {LOW_DAYS_THRESHOLD}일 이하 {rows.length}개{rows.length === 0 && " — 없음"}
          {basisTo && <span className="ml-1 font-normal text-zinc-500">(출고실적 {basisTo} 기준 최근 30일 일평균)</span>}
        </p>
      )}

      {mode === "unchecked" && (
        <>
          <p className="text-sm font-semibold text-amber-700">
            미확인 품목 {uncheckedTotal.toLocaleString()}개 — 최근 재고 파일에 없어 &ldquo;재고 확인 필요&rdquo;
            {uncheckedTotal > uncheckedRows.length && (
              <span className="ml-1 font-normal text-zinc-500">(이름순 {uncheckedRows.length}개 표시, 검색으로 좁히세요)</span>
            )}
          </p>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {uncheckedRows.map((p) => (
              <li key={p.code}>
                <Link href={`/stock/${encodeURIComponent(p.code)}`} className="flex items-center gap-3 px-3 py-2 active:bg-zinc-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="truncate text-xs text-zinc-500">{productInfoText(p)}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-amber-600">재고 확인 필요</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {mode === "search" && q.trim() === "" ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          품목명이나 품번을 입력하세요.
          <br />
          예: <span className="font-mono">2L</span>, <span className="font-mono">식용유</span>,{" "}
          <span className="font-mono">TM00329</span>
        </p>
      ) : mode === "search" && rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">&ldquo;{q}&rdquo;에 해당하는 품목이 없습니다.</p>
      ) : mode !== "unchecked" && rows.length > 0 ? (
        <>
          {mode === "search" && (
            <p className="text-xs text-zinc-500">
              {rows.length}개 품목{truncated && " (상위 50개만 표시 — 검색어를 더 구체적으로)"}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {rows.map((r) => {
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
                      <p className="mt-0.5 truncate text-xs text-zinc-500">{productInfoText(r)}</p>
                      <p className="mt-1 truncate text-xs text-zinc-500">
                        {needsCheck ? "최근 재고 파일에 없음" : `기초 ${s.baseline!.toLocaleString()}`} · 오늘 차감{" "}
                        {s.todayDeduction.toLocaleString()} · 소진 {daysText(r.days)}
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
      ) : null}
    </main>
  );
}
