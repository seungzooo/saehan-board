/**
 * 관리 대상 / 휴면 판정 + 재고 목록 행. 규칙은 lib/managed.ts, 원본 쿼리는 lib/activity-data.ts.
 * 출고실적에서 나오는 부분(기준월·관리 대상·최근 출고)은 캐시, 재고·소진일수는 실시간.
 */
import { LOW_DAYS_THRESHOLD } from "@/config/stock";
import type { ActivityBasis } from "@/lib/activity-data";
import { cachedActivityBasis, cachedActivityMap, cachedManagedCodes } from "@/lib/analytics/cached";
import { prisma } from "@/lib/db";
import { summarize, type StockListRow } from "@/lib/managed";
import { computeForProducts, daysOfStock, getShipmentRates } from "@/lib/stock";

export type { Activity, ActivityBasis } from "@/lib/activity-data";

export async function getActivityBasis(): Promise<ActivityBasis> {
  return cachedActivityBasis();
}

/** 관리 대상 품번 집합 (검색 범위 제한용) */
export async function getManagedCodes(): Promise<Set<string>> {
  return new Set(await cachedManagedCodes());
}

/** 등록된 전 품목(활성)의 목록 행 — 홈 집계와 재고 목록이 같은 데이터를 쓴다 */
export async function getStockUniverse(): Promise<{ basis: ActivityBasis; rows: StockListRow[] }> {
  const [basis, activityList, products] = await Promise.all([
    cachedActivityBasis(),
    cachedActivityMap(),
    prisma.product.findMany({ where: { isActive: true }, select: { code: true, name: true, packUnit: true, unitsPerBox: true } }),
  ]);
  const activity = new Map(activityList);
  const codes = products.map((p) => p.code);
  const [stocks, rates] = await Promise.all([computeForProducts(codes), getShipmentRates(codes)]);
  const rows: StockListRow[] = products.map((p) => {
    const a = activity.get(p.code);
    const stock = stocks.get(p.code)!;
    return {
      code: p.code,
      name: p.name,
      packUnit: p.packUnit,
      unitsPerBox: p.unitsPerBox,
      managed: !!a?.inWindow,
      stock,
      days: daysOfStock(stock, rates.get(p.code) ?? null, rates.basisTo).days,
      lastShipDate: a?.lastShipDate ?? null,
      recentCount: a?.recentCount ?? 0,
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
  const [basis, activityList] = await Promise.all([cachedActivityBasis(), cachedActivityMap()]);
  const a = new Map(activityList).get(code);
  return { basis, managed: !!a?.inWindow, lastShipDate: a?.lastShipDate ?? null };
}
