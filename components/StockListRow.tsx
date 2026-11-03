import { RECENT_QTY_MONTHS } from "@/config/stock";
import { shipUnitLabel, type StockListRow as Row } from "@/lib/managed";
import { formatShort } from "@/lib/format";
import { DiscontinuedBadge, isDiscontinued, isStockStale } from "@/lib/stockDisplay";
import Link from "next/link";

const nf = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

function Badge({ row, lowDays }: { row: Row; lowDays: number }) {
  if (isDiscontinued(row.name)) return <DiscontinuedBadge name={row.name} />;
  const parts: { text: string; cls: string }[] = [];
  if (!row.managed) parts.push({ text: "휴면", cls: "bg-zinc-100 text-zinc-600" });
  if (row.stock.available === null) parts.push({ text: "확인 필요", cls: "border border-dashed border-zinc-400 text-zinc-600" });
  else if (isStockStale(row.stock)) parts.push({ text: "오늘 자료 미반영", cls: "bg-amber-100 text-amber-800" });
  else if (row.stock.available <= 0) parts.push({ text: "재고 없음", cls: "bg-red-50 text-red-700" });
  else if (row.days !== null && row.days <= lowDays) parts.push({ text: "곧 소진", cls: "bg-orange-50 text-orange-700" });
  return (
    <span className="flex shrink-0 gap-1">
      {parts.map((p) => (
        <span key={p.text} className={`rounded px-1.5 py-0.5 text-xs font-semibold ${p.cls}`}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

/**
 * 재고 목록 한 행. 390px: 두 줄 (품명+배지 / 품번·수치), sm 이상: 한 줄.
 * 확인 필요 품목은 큰 문구 없이 작은 배지만 — 대신 최근 출고일과 최근 3개 달 출고량.
 */
export default function StockListRow({ row, lowDays }: { row: Row; lowDays: number }) {
  const checked = row.stock.available !== null;
  const muted = isDiscontinued(row.name);
  const unit = shipUnitLabel(row.packUnit, row.unitsPerBox);
  return (
    <li>
      <Link
        href={`/stock/${encodeURIComponent(row.code)}`}
        data-testid="list-row"
        className={`flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-blue-50 sm:flex-nowrap ${muted ? "text-zinc-400" : ""}`}
      >
        <span className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
          <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
          <span className="sm:hidden">
            <Badge row={row} lowDays={lowDays} />
          </span>
        </span>
        <span className="num flex w-full min-w-0 flex-wrap items-center gap-x-3 text-xs text-zinc-600 sm:w-auto sm:flex-nowrap sm:text-sm">
          <span className="font-mono text-zinc-500" data-testid="row-code">
            {row.code}
          </span>
          {checked ? (
            <>
              <span>
                현재 <b className={row.stock.available! <= 0 ? "text-red-600" : "text-zinc-900"}>{nf(row.stock.available!)}</b>박스
              </span>
              <span>소진 {row.days === null ? "산정 불가" : `${nf(row.days >= 10 ? Math.round(row.days) : row.days)}일`}</span>
              <span data-testid="row-asof">집계 {row.stock.stockAsOf ? formatShort(row.stock.stockAsOf) : "시각 미확인"}</span>
            </>
          ) : null}
          <span>최근 출고 {row.lastShipDate ?? "없음"}</span>
          <span data-testid="row-recent">
            최근 {RECENT_QTY_MONTHS}개월 출고 <b className="text-zinc-900" data-testid="row-recent-count">{row.recentCount.toLocaleString()}</b>회 ·{" "}
            <span data-testid="row-recent-qty">
              {nf(row.recentQty)}
              {unit}
            </span>
          </span>
        </span>
        <span className="hidden sm:inline">
          <Badge row={row} lowDays={lowDays} />
        </span>
      </Link>
    </li>
  );
}
