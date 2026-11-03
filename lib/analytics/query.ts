/**
 * F5 분석 데이터 — MonthlyStat(실적 업로드 시 재계산)에서 조회 시점에 계산. 캐시 없음.
 * 대상: 생산·판매 양쪽에 있는 품번(교집합)만. 한쪽만 있으면 "분석 불가".
 */
import { ANALYSIS_SALES_TYPE, ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { prisma } from "@/lib/db";
import { computeForProducts, daysOfStock, getShipmentRates, type DaysOfStock } from "@/lib/stock";
import type { AvailableStock } from "@/lib/availableStock";
import {
  bestLag,
  fillSeries,
  lagCorrelations,
  monthRange,
  seasonalIndex,
  type LagRow,
  type SeasonalRow,
} from "./seasonal";

/** 계절지수·상관 산정 기간 (CLAUDE.md: 2021~2025 5개년) */
export const SEASON_FROM = "2021-01";
export const SEASON_TO = "2025-12";
/** 월별 추이 그래프 기간 */
export const TREND_MONTHS = 24;
/** 전체 요약 상위 10: 5년 중 출고가 있던 달이 이 수 이상인 품목만 (드문 품목의 튀는 지수 제외) */
export const MIN_ACTIVE_MONTHS = 24;

export type Segment = "ALL" | "B2B" | "B2C";
export const SEGMENT_LABEL: Record<Segment, string> = { ALL: "전체", B2B: "B2B", B2C: "B2C" };

type StatRow = { productCode: string; yearMonth: string; qtyProducedBox: number; qtyShippedBox: number; qtyShippedB2B: number; qtyShippedB2C: number };

function shipOf(r: StatRow, seg: Segment): number {
  return seg === "B2B" ? r.qtyShippedB2B : seg === "B2C" ? r.qtyShippedB2C : r.qtyShippedBox;
}

/** 실적 기준일: 출고·생산 실적의 마지막 날짜 */
export async function getAnalysisBasis() {
  const [s, p] = await Promise.all([
    prisma.shipmentHistory.aggregate({ _max: { date: true }, where: { shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE } }),
    prisma.productionHistory.aggregate({ _max: { date: true } }),
  ]);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return { shipmentTo: iso(s._max.date), productionTo: iso(p._max.date) };
}

/** 교집합 품번 (생산 실적 있음 + 정상·내수 출고 있음) */
async function intersectionCodes(): Promise<Set<string>> {
  const rows = await prisma.monthlyStat.groupBy({ by: ["productCode"], _sum: { qtyProducedBox: true, qtyShippedBox: true } });
  return new Set(rows.filter((r) => (r._sum.qtyProducedBox ?? 0) > 0 && (r._sum.qtyShippedBox ?? 0) > 0).map((r) => r.productCode));
}

export async function countIntersection(): Promise<number> {
  return (await intersectionCodes()).size;
}

// ───────────────────────── 품목 분석 ─────────────────────────

export type ProductAnalysis =
  | {
      ok: true;
      product: { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category: string | null };
      stock: AvailableStock;
      days: DaysOfStock;
      trend: { yearMonth: string; production: number; shipment: number }[];
      seasonal: SeasonalRow[];
      lags: LagRow[];
      best: LagRow | null;
      currentMonth: number;
      seasonRange: { from: string; to: string };
    }
  | {
      ok: false;
      reason: "NOT_FOUND" | "NO_PRODUCTION" | "NO_SHIPMENT";
      product?: { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category: string | null };
    };

export async function getProductAnalysis(code: string, seg: Segment, now = new Date()): Promise<ProductAnalysis> {
  const product = await prisma.product.findUnique({
    where: { code },
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
  });
  if (!product) return { ok: false, reason: "NOT_FOUND" };
  const rows = await prisma.monthlyStat.findMany({
    where: { productCode: code },
    select: { productCode: true, yearMonth: true, qtyProducedBox: true, qtyShippedBox: true, qtyShippedB2B: true, qtyShippedB2C: true },
  });
  const produced = rows.reduce((s, r) => s + r.qtyProducedBox, 0);
  const shipped = rows.reduce((s, r) => s + r.qtyShippedBox, 0);
  if (produced <= 0) return { ok: false, reason: "NO_PRODUCTION", product };
  if (shipped <= 0) return { ok: false, reason: "NO_SHIPMENT", product };

  const prodMap = new Map(rows.map((r) => [r.yearMonth, r.qtyProducedBox]));
  const shipMap = new Map(rows.map((r) => [r.yearMonth, shipOf(r, seg)]));

  // 추이: 실적 마지막 달까지 24개월
  const lastYm = rows.map((r) => r.yearMonth).sort().at(-1)!;
  const trendMonths = monthRange(shiftMonth(lastYm, -(TREND_MONTHS - 1)), lastYm);
  const trend = trendMonths.map((ym) => ({ yearMonth: ym, production: round1(prodMap.get(ym) ?? 0), shipment: round1(shipMap.get(ym) ?? 0) }));

  // 계절지수·시차 상관: 2021~2025
  const seasonMonths = monthRange(SEASON_FROM, SEASON_TO);
  const prodSeries = fillSeries(seasonMonths, prodMap);
  const shipSeries = fillSeries(seasonMonths, shipMap);
  const seasonal = seasonalIndex(seasonMonths, shipSeries);
  const lags = lagCorrelations(prodSeries, shipSeries, 3);

  const [stocks, rates] = await Promise.all([computeForProducts([code]), getShipmentRates([code])]);
  const stock = stocks.get(code)!;
  const seoulMonth = Number(new Date(now.getTime() + 9 * 3600_000).toISOString().slice(5, 7));
  return {
    ok: true,
    product,
    stock,
    days: daysOfStock(stock, rates.get(code) ?? null, rates.basisTo),
    trend,
    seasonal,
    lags,
    best: bestLag(lags),
    currentMonth: seoulMonth,
    seasonRange: { from: SEASON_FROM, to: SEASON_TO },
  };
}

// ───────────────────────── 전체 요약 ─────────────────────────

export type SeasonalTopRow = {
  code: string;
  name: string;
  peakMonth: number;
  peakIndex: number;
  stock: AvailableStock;
  days: DaysOfStock;
};

export async function getOverview(seg: Segment) {
  const [rows, codes] = await Promise.all([
    prisma.monthlyStat.findMany({
      select: { productCode: true, yearMonth: true, qtyProducedBox: true, qtyShippedBox: true, qtyShippedB2B: true, qtyShippedB2C: true },
    }),
    intersectionCodes(),
  ]);
  const seasonMonths = monthRange(SEASON_FROM, SEASON_TO);

  // 전체 월별 출고 (교집합 품목만, 5개년)
  const total = new Map<string, number>();
  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!codes.has(r.productCode)) continue;
    const v = shipOf(r, seg);
    total.set(r.yearMonth, (total.get(r.yearMonth) ?? 0) + v);
    let m = byProduct.get(r.productCode);
    if (!m) byProduct.set(r.productCode, (m = new Map()));
    m.set(r.yearMonth, v);
  }
  const totalSeries = seasonMonths.map((ym) => ({ yearMonth: ym, shipment: Math.round(total.get(ym) ?? 0) }));
  const totalSeasonal = seasonalIndex(seasonMonths, totalSeries.map((t) => t.shipment));

  // 품목별 최고 계절지수
  const candidates: { code: string; peakMonth: number; peakIndex: number }[] = [];
  for (const [code, m] of byProduct) {
    const series = fillSeries(seasonMonths, m);
    if (series.filter((v) => v > 0).length < MIN_ACTIVE_MONTHS) continue;
    const s = seasonalIndex(seasonMonths, series);
    let peak: SeasonalRow | null = null;
    for (const r of s) if (r.index !== null && (peak === null || r.index > (peak.index as number))) peak = r;
    if (peak) candidates.push({ code, peakMonth: peak.month, peakIndex: peak.index as number });
  }
  candidates.sort((a, b) => b.peakIndex - a.peakIndex);
  const top = candidates.slice(0, 10);
  const [products, stocks, rates] = await Promise.all([
    prisma.product.findMany({ where: { code: { in: top.map((t) => t.code) } }, select: { code: true, name: true } }),
    computeForProducts(top.map((t) => t.code)),
    getShipmentRates(top.map((t) => t.code)),
  ]);
  const nameOf = new Map(products.map((p) => [p.code, p.name]));
  const topRows: SeasonalTopRow[] = top.map((t) => {
    const stock = stocks.get(t.code)!;
    return { ...t, name: nameOf.get(t.code) ?? t.code, stock, days: daysOfStock(stock, rates.get(t.code) ?? null, rates.basisTo) };
  });

  return {
    intersection: codes.size,
    eligible: candidates.length,
    totalSeries,
    totalSeasonal,
    top: topRows,
    seasonRange: { from: SEASON_FROM, to: SEASON_TO },
  };
}

/** 분석용 품목 검색: 교집합 여부 표시 */
export async function searchAnalysisProducts(q: string) {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const [items, codes] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        AND: terms.map((t) => ({ OR: [{ name: { contains: t, mode: "insensitive" as const } }, { code: { contains: t, mode: "insensitive" as const } }] })),
      },
      orderBy: { name: "asc" },
      take: 30,
      select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
    }),
    intersectionCodes(),
  ]);
  return items.map((p) => ({ ...p, analyzable: codes.has(p.code) })).sort((a, b) => Number(b.analyzable) - Number(a.analyzable));
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}
