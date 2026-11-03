/**
 * 관리 대상 / 휴면 판정용 출고 활동 — 원본 쿼리 (캐시 없음). 캐시는 lib/analytics/cached.ts, 사용은 lib/activity.ts.
 * 모든 집계는 정상·내수 출고만 (재고 관리 기준). 분석 탭의 "정상 출고" 기준과는 다르다.
 * 반환값은 캐시에 JSON으로 저장되므로 Map·Date 대신 배열·문자열.
 */
import { ANALYSIS_SALES_TYPE, ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { ACTIVE_MONTHS, RECENT_QTY_MONTHS } from "@/config/stock";
import { prisma } from "@/lib/db";
import { activeWindow, shiftYm } from "@/lib/managed";

export const NORMAL_DOMESTIC = { shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE, qtyUnits: { gt: 0 } };

export type ActivityBasis = {
  latestShipDate: string; // 최근 정상·내수 출고일
  basisYm: string; // 기준월
  fromYm: string; // 집계 시작월 (기준월 포함 ACTIVE_MONTHS개 달)
  months: number;
  recentFromYm: string; // 최근 RECENT_QTY_MONTHS개 달 시작월
} | null;

export async function getActivityBasis(): Promise<ActivityBasis> {
  const last = await prisma.shipmentHistory.aggregate({ _max: { date: true }, where: NORMAL_DOMESTIC });
  const d = last._max.date;
  if (!d) return null;
  const latestShipDate = d.toISOString().slice(0, 10);
  const w = activeWindow(latestShipDate, ACTIVE_MONTHS);
  return { latestShipDate, basisYm: w.toYm, fromYm: w.fromYm, months: ACTIVE_MONTHS, recentFromYm: shiftYm(w.toYm, -(RECENT_QTY_MONTHS - 1)) };
}

export type Activity = { lastShipDate: string | null; inWindow: boolean; recentCount: number; recentQty: number };

/**
 * 품번별 최근 정상·내수 출고일(전 기간), 기간 내 출고 여부, 최근 3개 달 출고 건수와 출고량: [품번, Activity][].
 * 건수 = 출고 행 수. 출고실적은 (출고일자, 품번, 전표번호)가 유일하므로 품번별 행 수 = 그 품번이 실린 전표 수.
 */
export async function getActivityMapData(): Promise<[string, Activity][]> {
  const basis = await getActivityBasis();
  if (!basis) return [];
  const [lastRows, windowRows, recentRows] = await Promise.all([
    prisma.shipmentHistory.groupBy({ by: ["productCode"], where: NORMAL_DOMESTIC, _max: { date: true } }),
    prisma.shipmentHistory.groupBy({
      by: ["productCode"],
      where: { ...NORMAL_DOMESTIC, yearMonth: { gte: basis.fromYm, lte: basis.basisYm } },
      _count: { _all: true },
    }),
    prisma.shipmentHistory.groupBy({
      by: ["productCode"],
      where: { ...NORMAL_DOMESTIC, yearMonth: { gte: basis.recentFromYm, lte: basis.basisYm } },
      _sum: { qtyBox: true },
      _count: { _all: true },
    }),
  ]);
  const inWin = new Set(windowRows.map((r) => r.productCode));
  const recent = new Map(recentRows.map((r) => [r.productCode, r._sum.qtyBox ?? 0]));
  const recentCount = new Map(recentRows.map((r) => [r.productCode, r._count._all]));
  return lastRows.map((r) => [
    r.productCode,
    {
      lastShipDate: r._max.date ? r._max.date.toISOString().slice(0, 10) : null,
      inWindow: inWin.has(r.productCode),
      recentCount: recentCount.get(r.productCode) ?? 0,
      recentQty: Math.round((recent.get(r.productCode) ?? 0) * 10) / 10,
    },
  ]);
}

/** 관리 대상 품번 목록 (검색 범위 제한용) */
export async function getManagedCodeList(): Promise<string[]> {
  const basis = await getActivityBasis();
  if (!basis) return [];
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["productCode"],
    where: { ...NORMAL_DOMESTIC, yearMonth: { gte: basis.fromYm, lte: basis.basisYm } },
  });
  return rows.map((r) => r.productCode);
}
