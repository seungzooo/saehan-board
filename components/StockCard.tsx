import { formatShort } from "@/lib/format";
import type { StockRow } from "@/lib/stock";
import { availableText, daysText, DiscontinuedBadge, isDiscontinued, productInfoText, StatusBadge, stockStatus } from "@/lib/stockDisplay";
import Link from "next/link";

/** 검색 결과 카드: 품명 / 현재 재고 크게 / 집계 기준 시각 작게. 카드 전체가 상세 링크. 단종은 회색 */
export default function StockCard({ row, q }: { row: StockRow; q?: string }) {
  const s = row.stock;
  const st = stockStatus(s, row.days);
  const needsCheck = s.available === null;
  const discontinued = isDiscontinued(row.name);
  return (
    <Link
      href={`/stock/${encodeURIComponent(row.code)}${q ? `?q=${encodeURIComponent(q)}` : ""}`}
      data-discontinued={discontinued || undefined}
      className={`flex min-h-12 flex-col gap-1 rounded-lg border bg-white px-4 py-3 hover:border-blue-400 hover:bg-blue-50/40 ${st.cardClass} ${
        discontinued ? "text-zinc-400" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`min-w-0 flex-1 truncate text-base font-semibold ${discontinued ? "text-zinc-400" : ""}`}>{row.name}</p>
        <DiscontinuedBadge name={row.name} />
        {!discontinued && <StatusBadge status={st} />}
      </div>
      <p className="truncate text-xs text-zinc-500">{productInfoText(row)}</p>
      <div className="flex items-end justify-between gap-2">
        <p className={`num font-bold leading-none ${needsCheck ? "text-2xl" : "text-5xl"} ${discontinued ? "text-zinc-400" : st.numClass}`}>
          {availableText(s)}
          {!needsCheck && <span className="ml-1 text-base font-normal text-zinc-500">박스</span>}
        </p>
        <p className="num shrink-0 text-right text-xs text-zinc-500">
          {needsCheck ? (
            "최근 재고 파일에 없음"
          ) : (
            <>
              집계 {s.stockAsOf ? formatShort(s.stockAsOf) : "미확인"}
              <br />
              소진 {daysText(row.days)}
            </>
          )}
        </p>
      </div>
    </Link>
  );
}
