/** 재고 수량·기준 시각·품목 정보 표시 규칙 — 검색 목록·상세·홈·변동 입력이 모두 이 파일을 쓴다 */
import { LOW_DAYS_THRESHOLD, STALE_AFTER_HOURS } from "@/config/stock";
import type { AvailableStock } from "@/lib/availableStock";
import { formatDateTime, formatShort, isStale } from "@/lib/format";
import { isDiscontinued, productCapacityLabel } from "@/lib/search";

export { isDiscontinued };
import type { DaysOfStock, StockBasis } from "@/lib/stock";

export const NEEDS_CHECK = "확인 필요";

/**
 * 상태 = 색 + 글자 (색만으로 구분하지 않는다)
 *   정상 = 검정 · 곧 소진(소진 3일 이하) = 주황 · 재고 없음(0박스 이하) = 빨강 · 확인 필요 = 회색 점선 테두리
 */
export type StockStatusKey = "OK" | "LOW" | "OUT" | "CHECK" | "STALE";
export type StockStatus = { key: StockStatusKey; label: string | null; numClass: string; cardClass: string; badgeClass: string };

/** 품목 재고의 기준 시각 = 집계 기준 시각, 없으면 파일 반영 시각 */
export function stockBasisAt(s: AvailableStock): Date | null {
  const t = s.stockAsOf ?? s.uploadedAt;
  return t ? new Date(t) : null;
}

/** 오늘 자료 미반영: 확인된 품목인데 기준 시각이 STALE_AFTER_HOURS보다 오래됨 */
export function isStockStale(s: AvailableStock, now = new Date()): boolean {
  const t = stockBasisAt(s);
  return s.available !== null && t !== null && isStale(t, STALE_AFTER_HOURS, now);
}

/** 출고 가능 판정을 해도 되는가 — 확인 필요·오늘 자료 미반영이면 보류 */
export function canJudge(s: AvailableStock, now = new Date()): boolean {
  return s.available !== null && !isStockStale(s, now);
}

/**
 * 우선순위: 확인 필요(최신 파일에 없음) → 오늘 자료 미반영(마지막 확인 수량, 판정 보류) → 재고 없음(0 이하) → 곧 소진 → 정상
 * "재고 없음"은 확인된 실제 0, "확인 필요"는 모름, "오늘 자료 미반영"은 오래된 확인값 — 셋을 구분한다.
 */
export function stockStatus(s: AvailableStock, d?: DaysOfStock | null, now = new Date()): StockStatus {
  if (s.available === null)
    return { key: "CHECK", label: "확인 필요", numClass: "text-zinc-400", cardClass: "border-dashed border-zinc-400", badgeClass: "border border-dashed border-zinc-400 text-zinc-600" };
  if (isStockStale(s, now))
    return { key: "STALE", label: "오늘 자료 미반영", numClass: "text-zinc-500", cardClass: "border-amber-300", badgeClass: "bg-amber-100 text-amber-800" };
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

/** 예상 소진일수: "2.5일" / "40일 (12개월 평균)"(간헐 출고 품목) / "산정 불가" — 목록·상세·홈 공용 */
export function daysNumText(days: number | null, window: DaysOfStock["window"] = "30d"): string {
  if (days === null) return "산정 불가";
  const n = days >= 10 ? Math.round(days).toLocaleString() : String(Number(days.toFixed(1)));
  return window === "12m" ? `${n}일 (12개월 평균)` : `${n}일`;
}
export function daysText(d: DaysOfStock): string {
  return daysNumText(d.days, d.window);
}

/** 일평균 산정 방식 이름: "최근 30일 일평균" / "최근 12개월 일평균" */
export function rateLabel(window: DaysOfStock["window"]): string {
  return window === "12m" ? "최근 12개월 일평균" : "최근 30일 일평균";
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
      {basis.partial && (
        <span data-testid="basis-partial" className="ml-1 text-zinc-500">
          · 일부 갱신 파일 — 파일에 없던 품목은 이전 수량·집계 시각 유지 (품목마다 표시)
        </span>
      )}
    </p>
  );
}

/** 품목 한 줄 설명: "품번 TM00655 · 용량 2L · 1박스당 100개 · PET1" */
export type ProductInfoLike = { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category?: string | null };
export function productInfoText(p: ProductInfoLike): string {
  const parts = [`품번 ${p.code}`];
  const cap = productCapacityLabel(p);
  if (cap) parts.push(`용량 ${cap}`);
  parts.push(packLabel(p.packUnit, p.unitsPerBox));
  if (p.category) parts.push(p.category);
  return parts.join(" · ");
}

/** 포장단위 이름으로 쓰는 값 — "1박스당", "1파렛트당", "1필름당" */
const NAMED_PACK_UNITS = ["박스", "파렛트", "필름"];

/**
 * 입수 표시. 포장단위가
 *   박스·파렛트·필름   → "1박스당 105개" (단위 이름 그대로)
 *   규격 코드(83*155 등) → "1포장(83*155)당 90개"
 *   "없음" 또는 빈 값    → "입수 105개"
 *   그 밖의 코드(A14P 등) → "1포장(A14P)당 N개"
 */
export function packLabel(packUnit: string | null | undefined, unitsPerBox: number): string {
  const unit = (packUnit ?? "").trim();
  const n = unitsPerBox.toLocaleString();
  if (!unit || unit === "없음") return `입수 ${n}개`;
  if (NAMED_PACK_UNITS.includes(unit)) return `1${unit}당 ${n}개`;
  return `1포장(${unit})당 ${n}개`;
}

/** 단종(품명이 "폐기"로 시작) 배지 — 목록 맨 아래, 회색 */
export function DiscontinuedBadge({ name }: { name: string }) {
  if (!isDiscontinued(name)) return null;
  return <span className="inline-block shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-500">단종</span>;
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
