/**
 * 품목 하나의 출고 요약 — 간헐 출고 품목 처리 (순수 함수, 테스트 tests/itemStats.test.ts).
 * 입력은 [연월, 거래처, 정상 출고 건수][] (판매형태 무관 정상 출고, 분석 화면 기준).
 *
 * - 요약 한 줄: "2025년 출고 5회 · 거래처 1곳(강남주조) · 출고한 달 5/12" — 거래처가 3곳 이하면 이름까지.
 *   분모(달 수)는 그 기간의 **집계 완료된 달**만 센다(자료 없음·집계 중인 달은 빼고).
 * - 간헐 출고: 출고한 달이 기간 달 수의 절반 이하 → 월별 증감률보다 연간 합계로 비교하라고 안내.
 * - 월말 일괄 기록: 정상 출고일이 2건 이상이고 전부 그달 마지막 날 → 실제 출고 시점과 다를 수 있음.
 */
export type ItemShipRow = [ym: string, customer: string, count: number];

export type ItemShipData = {
  rows: ItemShipRow[];
  /** 정상 출고 행 수 · 그중 월말(그달 마지막 날) 출고 행 수 */
  shipments: number;
  monthEndShipments: number;
};

export type ItemSummary = { count: number; customers: string[]; shippedMonths: number; totalMonths: number };

export const SUMMARY_NAME_LIMIT = 3;

/** months: 기간 안 집계 완료된 달 목록 (YYYY-MM) */
export function summarizeItem(rows: ItemShipRow[], months: string[]): ItemSummary {
  const inRange = new Set(months);
  const shipped = new Set<string>();
  const customers = new Set<string>();
  let count = 0;
  for (const [ym, customer, n] of rows) {
    if (!inRange.has(ym) || n <= 0) continue;
    count += n;
    shipped.add(ym);
    customers.add(customer);
  }
  return { count, customers: [...customers].sort((a, b) => a.localeCompare(b, "ko")), shippedMonths: shipped.size, totalMonths: inRange.size };
}

/** "2025년 출고 5회 · 거래처 1곳(강남주조) · 출고한 달 5/12" */
export function summaryLine(label: string, s: ItemSummary): string {
  const names = s.customers.length > 0 && s.customers.length <= SUMMARY_NAME_LIMIT ? `(${s.customers.join(", ")})` : "";
  return `${label} 출고 ${s.count.toLocaleString()}회 · 거래처 ${s.customers.length.toLocaleString()}곳${names} · 출고한 달 ${s.shippedMonths}/${s.totalMonths}`;
}

/** 출고한 달이 기간의 절반 이하 (기간이 있을 때만) */
export function isIntermittent(s: ItemSummary): boolean {
  return s.totalMonths > 0 && s.shippedMonths * 2 <= s.totalMonths;
}

export const INTERMITTENT_NOTE = "간헐 출고 품목 — 월별 증감률보다 연간 합계로 비교하세요";
export const MONTH_END_NOTE = "월말 일괄 기록 품목 — 실제 출고 시점과 다를 수 있음";

/** 정상 출고가 2건 이상이고 전부 그달 마지막 날 */
export function isMonthEndOnly(d: Pick<ItemShipData, "shipments" | "monthEndShipments">): boolean {
  return d.shipments >= 2 && d.monthEndShipments === d.shipments;
}

/** YYYY-MM-DD가 그달 마지막 날인가 */
export function isMonthEnd(isoDate: string): boolean {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
}
