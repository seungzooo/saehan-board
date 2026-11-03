import ClickableRow from "@/components/ClickableRow";
import { REASON_LABEL } from "@/lib/availableStock";
import { formatShort } from "@/lib/format";

/** 종류 배지 색 — 글자와 함께 (색만으로 구분하지 않음) */
export const REASON_BADGE: Record<string, string> = {
  SHIPMENT: "bg-zinc-100 text-zinc-800",
  DEFECT: "bg-red-50 text-red-700",
  ORDER: "bg-orange-50 text-orange-700",
  OTHER: "bg-zinc-50 text-zinc-600 border border-zinc-200",
};

export function ReasonBadge({ reason, isCorrection = false }: { reason: string; isCorrection?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${REASON_BADGE[reason] ?? REASON_BADGE.OTHER}`}>
        {(REASON_LABEL as Record<string, string>)[reason] ?? reason}
      </span>
      {isCorrection && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">정정</span>}
    </span>
  );
}

export type AdjustmentRowData = {
  id: number;
  createdAt: Date | string;
  reason: string;
  qtyBox: number;
  createdBy: string;
  memo: string | null;
  cancelled: boolean;
  isCorrection: boolean;
  productName?: string;
};

/** 변동 이력 표: 시각·종류·수량·입력자. 행을 누르면 변동 상세 */
export default function AdjustmentTable({ rows, showProduct = false }: { rows: AdjustmentRowData[]; showProduct?: boolean }) {
  if (rows.length === 0) return <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">변동 이력이 없습니다.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      <table className="num w-full table-fixed text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500">
          <tr>
            <th className="w-[5.5rem] px-2 py-2 text-left font-medium">시각</th>
            <th className="px-2 py-2 text-left font-medium">{showProduct ? "품목 · 종류" : "종류"}</th>
            <th className="w-16 px-2 py-2 text-right font-medium">수량</th>
            <th className="w-16 px-2 py-2 text-right font-medium">입력자</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {rows.map((r) => (
            <ClickableRow key={r.id} href={`/adjust/${r.id}`} className={r.cancelled ? "text-zinc-400" : ""}>
              <td className="px-2 py-3 text-xs">{formatShort(r.createdAt)}</td>
              <td className="truncate px-2 py-3">
                {showProduct && r.productName && <span className="mr-1 font-medium">{r.productName}</span>}
                <ReasonBadge reason={r.reason} isCorrection={r.isCorrection} />
                {r.cancelled && <span className="ml-1 text-xs">취소됨</span>}
                {r.memo && <span className="ml-1 text-xs text-zinc-500">{r.memo}</span>}
              </td>
              <td className={`px-2 py-3 text-right font-semibold ${r.cancelled ? "line-through" : ""}`}>
                {r.qtyBox > 0 ? "−" : "+"}
                {Math.abs(r.qtyBox).toLocaleString()}
              </td>
              <td className="truncate px-2 py-3 text-right text-xs">{r.createdBy}</td>
            </ClickableRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
