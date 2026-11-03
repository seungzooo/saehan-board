/** 재고 수량·기준 시각·품목 정보 표시 규칙 — 검색 목록·상세·홈·변동 입력이 모두 이 파일을 쓴다 */
import { LOW_DAYS_THRESHOLD, STALE_AFTER_HOURS } from "@/config/stock";
import type { AvailableStock } from "@/lib/availableStock";
import { formatDateTime, formatShort, isStale } from "@/lib/format";
import { productCapacityLabel } from "@/lib/search";
import type { DaysOfStock, StockBasis } from "@/lib/stock";

export const NEEDS_CHECK = "확인 필요";

/**
 * 상태 = 색 + 글자 (색만으로 구분하지 않는다)
 *   정상 = 검정 · 곧 소진(소진 3일 이하) = 주황 · 재고 없음(0박스 이하) = 빨강 · 확인 필요 = 회색 점선 테두리
 */
export type StockStatusKey = "OK" | "LOW" | "OUT" | "CHECK";
export type StockStatus = { key: StockStatusKey; label: string | null; numClass: string; cardClass: string; badgeClass: string };
export function stockStatus(s: AvailableStock, d?: DaysOfStock | null): StockStatus {
  if (s.available === null)
    return { key: "CHECK", label: "확인 필요", numClass: "text-zinc-400", cardClass: "border-dashed border-zinc-400", badgeClass: "border border-dashed border-zinc-400 text-zinc-600" };
  if (s.available <= 0)
    return { key: "OUT", label: "재고 없음", numClass: "text-red-600", cardClass: "border-zinc-200", badgeClass: "bg-red-50 text-red-700" };
  if (d && d.days !== null && d.days <= LOW_DAYS_THRESHOLD)
    return { key: "LOW", label: "곧 소진", numClass: "text-orange-600", cardClass: "border-zinc-200", badgeClass: "bg-orange-50 text-orange-700" };
  return { key: "OK", label: null, numClass: "text-zinc-900", cardClass: "border-zinc-200", badgeClass: "" };
}

export function StatusBadge({ status }: { status: StockStatus }) {
  if (!status.label) return null;
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${status.badgeClass}`}>{status.label}</span>;
}

/** 현재 재고 문자열: null → "확인 필요", 숫자 → "1,234" */
export function availableText(s: AvailableStock): string {
  return s.available === null ? NEEDS_CHECK : s.available.toLocaleString();
}

/** 예상 소진일수: "2.5일" / "산정 불가" */
export function daysText(d: DaysOfStock): string {
  if (d.days === null) return "산정 불가";
  return `${d.days >= 10 ? Math.round(d.days) : Number(d.days.toFixed(1))}일`;
}

/** 수량 색상 — stockStatus와 같은 규칙 */
export function availableTone(s: AvailableStock, d?: DaysOfStock | null): string {
  return stockStatus(s, d).numClass;
}

/** "재고 집계 기준 11-03 09:00 · 파일 반영 11-03 09:12" / "집계 시각 미확인 · 파일 반영 …" */
export function basisText(b: { uploadedAt: Date; stockAsOf: Date | null }, long = false): string {
  const f = long ? formatDateTime : formatShort;
  const asOf = b.stockAsOf ? `재고 집계 기준 ${f(b.stockAsOf)}` : "집계 시각 미확인";
  return `${asOf} · 파일 반영 ${f(b.uploadedAt)}`;
}

export function StaleBadge({ uploadedAt }: { uploadedAt: Date }) {
  if (!isStale(uploadedAt, STALE_AFTER_HOURS)) return null;
  return (
    <span
      className="ml-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800"
      title={`마지막 파일 반영 후 ${STALE_AFTER_HOURS}시간 경과`}
    >
      갱신 지연
    </span>
  );
}

/** 헤더용 한 줄: 기준 없음 / 집계·반영 시각 + 갱신 지연 배지 */
export function BasisLine({ basis, long = false, className = "" }: { basis: StockBasis; long?: boolean; className?: string }) {
  if (!basis) return <p className={`text-xs text-red-600 ${className}`}>아직 재고 파일이 없습니다</p>;
  return (
    <p className={`text-xs text-zinc-600 ${className}`}>
      <span>{basisText(basis, long)}</span>
      <StaleBadge uploadedAt={basis.uploadedAt} />
    </p>
  );
}

/** 품목 한 줄 설명: "품번 TM00655 · 용량 2L · 1박스당 100개 · PET1" */
export type ProductInfoLike = { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category?: string | null };
export function productInfoText(p: ProductInfoLike): string {
  const parts = [`품번 ${p.code}`];
  const cap = productCapacityLabel(p);
  if (cap) parts.push(`용량 ${cap}`);
  parts.push(`1${p.packUnit || "박스"}당 ${p.unitsPerBox.toLocaleString()}개`);
  if (p.category) parts.push(p.category);
  return parts.join(" · ");
}

/** 파일명에 샘플·테스트·개발용이 들어가면 샘플 데이터로 표시 */
export function isSampleFileName(fileName: string): boolean {
  return /샘플|테스트|개발용|sample|test|dev/i.test(fileName);
}
export function SampleBadge({ fileName }: { fileName: string }) {
  if (!isSampleFileName(fileName)) return null;
  return (
    <span className="ml-1 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-800" title="파일명에 샘플·테스트·개발용 포함">
      샘플
    </span>
  );
}
