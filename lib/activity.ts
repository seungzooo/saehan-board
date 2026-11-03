/**
 * 관리 대상 / 휴면 판정에 쓰는 출고 활동 (DB). 규칙은 lib/managed.ts.
 * 모든 집계는 정상·내수 출고만 (재고 관리 기준). 분석 탭의 "정상 출고" 기준과는 다르다.
 */
import { ANALYSIS_SALES_TYPE, ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { ACTIVE_MONTHS, LOW_DAYS_THRESHOLD, RECENT_QTY_MONTHS } from "@/config/stock";
import { prisma } from "@/lib/db";
import { activeWindow, shiftYm, summarize, type StockListRow } from "@/lib/managed";
import { computeForProducts, daysOfStock, getShipmentRates } from "@/lib/stock";

const NORMAL_DOMESTIC = { shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE, qtyUnits: { gt: 0 } };

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

export type Activity = { lastShipDate: string | null; inWindow: boolean; recentQty: number };

/** 품번별 최근 정상·내수 출고일(전 기간), 기간 내 출고 여부, 최근 3개 달 출고량 */
export async function getActivityMap(basis: ActivityBasis): Promise<Map<string, Activity>> {
  const map = new Map<string, Activity>();
  if (!basis) return map;
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
    }),
  ]);
  const inWin = new Set(windowRows.map((r) => r.productCode));
  const recent = new Map(recentRows.map((r) => [r.productCode, r._sum.qtyBox ?? 0]));
  for (const r of lastRows) {
    map.set(r.productCode, {
      lastShipDate: r._max.date ? r._max.date.toISOString().slice(0, 10) : null,
      inWindow: inWin.has(r.productCode),
      recentQty: Math.round((recent.get(r.productCode) ?? 0) * 10) / 10,
    });
  }
  return map;
}

/** 관리 대상 품번 집합 (검색 범위 제한용) */
export async function getManagedCodes(): Promise<Set<string>> {
  const basis = await getActivityBasis();
  if (!basis) return new Set();
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["productCode"],
    where: { ...NORMAL_DOMESTIC, yearMonth: { gte: basis.fromYm, lte: basis.basisYm } },
  });
  return new Set(rows.map((r) => r.productCode));
}

/** 등록된 전 품목(활성)의 목록 행 — 홈 집계와 재고 목록이 같은 데이터를 쓴다 */
export async function getStockUniverse(): Promise<{ basis: ActivityBasis; rows: StockListRow[] }> {
  const basis = await getActivityBasis();
  const products = await prisma.product.findMany({ where: { isActive: true }, select: { code: true, name: true, packUnit: true } });
  const codes = products.map((p) => p.code);
  const [activity, stocks, rates] = await Promise.all([getActivityMap(basis), computeForProducts(codes), getShipmentRates(codes)]);
  const rows: StockListRow[] = products.map((p) => {
    const a = activity.get(p.code);
    const stock = stocks.get(p.code)!;
    return {
      code: p.code,
      name: p.name,
      packUnit: p.packUnit,
      managed: !!a?.inWindow,
      stock,
      days: daysOfStock(stock, rates.get(p.code) ?? null, rates.basisTo).days,
      lastShipDate: a?.lastShipDate ?? null,
      recentQty: a?.recentQty ?? 0,
    };
  });
  return { basis, rows };
}

export async function getHomeSummary() {
  const { basis, rows } = await getStockUniverse();
  return { basis, rows, summary: summarize(rows, LOW_DAYS_THRESHOLD) };
}

/** 품목 상세용: 관리 대상 여부와 최근 정상·내수 출고일 */
export async function getProductActivity(code: string): Promise<{ basis: ActivityBasis; managed: boolean; lastShipDate: string | null }> {
  const basis = await getActivityBasis();
  if (!basis) return { basis, managed: false, lastShipDate: null };
  const [last, inWin] = await Promise.all([
    prisma.shipmentHistory.aggregate({ where: { ...NORMAL_DOMESTIC, productCode: code }, _max: { date: true } }),
    prisma.shipmentHistory.count({ where: { ...NORMAL_DOMESTIC, productCode: code, yearMonth: { gte: basis.fromYm, lte: basis.basisYm } } }),
  ]);
  return { basis, managed: inWin > 0, lastShipDate: last._max.date ? last._max.date.toISOString().slice(0, 10) : null };
}
