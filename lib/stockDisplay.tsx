/** 재고 수량·기준 시각 표시 규칙 — 검색 목록·상세·홈이 모두 이 파일을 쓴다 */
import { STALE_AFTER_HOURS } from "@/config/stock";
import type { AvailableStock } from "@/lib/availableStock";
import { formatDateTime, formatShort, isStale } from "@/lib/format";
import type { StockBasis } from "@/lib/stock";

export const NEEDS_CHECK = "확인 필요";

/** 가용재고 문자열: null → "확인 필요", 숫자 → "1,234" */
export function availableText(s: AvailableStock): string {
  return s.available === null ? NEEDS_CHECK : s.available.toLocaleString();
}

/** 수량 색상: 확인 필요=주황, 0 이하=빨강, 그 외=검정 */
export function availableTone(s: AvailableStock): string {
  if (s.available === null) return "text-amber-600";
  return s.available <= 0 ? "text-red-600" : "text-zinc-900";
}

/** "집계 기준 11-03 09:00 · 반영 11-03 09:12" / "집계 시각 미확인 · 반영 …" */
export function basisText(b: { uploadedAt: Date; stockAsOf: Date | null }, long = false): string {
  const f = long ? formatDateTime : formatShort;
  const asOf = b.stockAsOf ? `집계 기준 ${f(b.stockAsOf)}` : "집계 시각 미확인";
  return `${asOf} · 반영 ${f(b.uploadedAt)}`;
}

export function StaleBadge({ uploadedAt }: { uploadedAt: Date }) {
  if (!isStale(uploadedAt, STALE_AFTER_HOURS)) return null;
  return (
    <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800" title={`마지막 반영 후 ${STALE_AFTER_HOURS}시간 경과`}>
      갱신 지연
    </span>
  );
}

/** 헤더용 한 줄: 기준 없음 / 집계·반영 시각 + 갱신 지연 배지 */
export function BasisLine({ basis, long = false, className = "" }: { basis: StockBasis; long?: boolean; className?: string }) {
  if (!basis) return <p className={`text-xs text-red-600 ${className}`}>아직 재고 파일이 없습니다</p>;
  return (
    <p className={`text-xs text-zinc-600 ${className}`}>
      <span className="whitespace-nowrap">{basisText(basis, long)}</span>
      <StaleBadge uploadedAt={basis.uploadedAt} />
    </p>
  );
}
