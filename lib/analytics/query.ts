/**
 * F5 분석 데이터 — MonthlyStat(실적 업로드 시 재계산)에서 조회 시점에 계산. 캐시 없음.
 *
 * 기준 (2026-11-03 개정)
 * - 판매량 = **정상 출고** (판매형태 전체). 재고 관리용 "내수" 필터는 분석에 쓰지 않는다. 반품은 따로 표시.
 * - 생산량 = A급, 전표구분 21 본가공입고 + 22 재가공입고 (32 재가공투입 제외), 박스 환산.
 * - 대상: 생산 > 0 이고 정상 출고 > 0 인 품번(교집합). 한쪽만 있으면 "분석 불가".
 * - 결측월: 자료 범위(그 실적 전체의 첫 달~마지막 달) 안의 빈 달 = 실제 0, 범위 밖 = 자료 없음(계산 제외).
 * - 시차: 생산월 t ↔ 출고월 t+k, k = 0..6, 달력 기준. 유효 월 쌍 수 n을 함께 낸다.
 */
import { prisma } from "@/lib/db";
import type { AvailableStock } from "@/lib/availableStock";
import { computeForProducts, daysOfStock, getShipmentRates, type DaysOfStock } from "@/lib/stock";
import {
  bestLag,
  coveredSeries,
  fillSeries,
  lagCorrelationsCalendar,
  monthRange,
  seasonalIndex,
  yearlySeasonal,
  type Coverage,
  type LagRow,
  type SeasonalRow,
  type YearRow,
} from "./seasonal";

/** 5년 평균 계절지수 기간 (CLAUDE.md: 2021~2025 5개년) */
export const SEASON_FROM = "2021-01";
export const SEASON_TO = "2025-12";
/** 월별 추이 그래프 기간 */
export const TREND_MONTHS = 24;
/** 생산→출고 시차 최대 개월 */
export const MAX_LAG = 6;
/** 전체 요약 상위 10: 5년 중 정상 출고가 있던 달이 이 수 이상인 품목만 (드문 품목의 튀는 지수 제외) */
export const MIN_ACTIVE_MONTHS = 24;

export type Segment = "ALL" | "B2B" | "B2C";
export const SEGMENT_LABEL: Record<Segment, string> = { ALL: "전체", B2B: "B2B", B2C: "B2C" };

type StatRow = {
  productCode: string;
  yearMonth: string;
  qtyProducedBox: number;
  qtyNormalBox: number;
  qtyNormalB2B: number;
  qtyNormalB2C: number;
  qtyReturnBox: number;
};
const STAT_SELECT = {
  productCode: true,
  yearMonth: true,
  qtyProducedBox: true,
  qtyNormalBox: true,
  qtyNormalB2B: true,
  qtyNormalB2C: true,
  qtyReturnBox: true,
} as const;

function shipOf(r: StatRow, seg: Segment): number {
  return seg === "B2B" ? r.qtyNormalB2B : seg === "B2C" ? r.qtyNormalB2C : r.qtyNormalBox;
}

export type AnalysisBasis = {
  shipmentTo: string | null; // 정상 출고 마지막 날짜
  productionTo: string | null;
  salesCoverage: Coverage; // 출고실적 자료 범위 (연월)
  productionCoverage: Coverage;
};

/** 실적 기준일과 자료 범위 */
export async function getAnalysisBasis(): Promise<AnalysisBasis> {
  const [s, sAll, p] = await Promise.all([
    prisma.shipmentHistory.aggregate({ _max: { date: true }, where: { shipType: "정상" } }),
    prisma.shipmentHistory.aggregate({ _min: { yearMonth: true }, _max: { yearMonth: true } }),
    prisma.productionHistory.aggregate({ _max: { date: true }, _min: { yearMonth: true } }),
  ]);
  const pMaxYm = await prisma.productionHistory.aggregate({ _max: { yearMonth: true } });
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return {
    shipmentTo: iso(s._max.date),
    productionTo: iso(p._max.date),
    salesCoverage: sAll._min.yearMonth && sAll._max.yearMonth ? { from: sAll._min.yearMonth, to: sAll._max.yearMonth } : null,
    productionCoverage: p._min.yearMonth && pMaxYm._max.yearMonth ? { from: p._min.yearMonth, to: pMaxYm._max.yearMonth } : null,
  };
}

/** 교집합 품번 (생산 > 0 + 정상 출고 > 0) */
async function intersectionCodes(): Promise<Set<string>> {
  const rows = await prisma.monthlyStat.groupBy({ by: ["productCode"], _sum: { qtyProducedBox: true, qtyNormalBox: true } });
  return new Set(rows.filter((r) => (r._sum.qtyProducedBox ?? 0) > 0 && (r._sum.qtyNormalBox ?? 0) > 0).map((r) => r.productCode));
}

export async function countIntersection(): Promise<number> {
  return (await intersectionCodes()).size;
}

/** 자료 범위로 자른 계절지수 기간 */
function seasonMonths(cov: Coverage): string[] {
  if (!cov) return [];
  const from = cov.from > SEASON_FROM ? cov.from : SEASON_FROM;
  const to = cov.to < SEASON_TO ? cov.to : SEASON_TO;
  return from <= to ? monthRange(from, to) : [];
}

/** 생산·출고 자료 범위를 합친 달력 (시차 상관용) */
function unionMonths(a: Coverage, b: Coverage): string[] {
  if (!a || !b) return [];
  return monthRange(a.from < b.from ? a.from : b.from, a.to > b.to ? a.to : b.to);
}

function series(rows: StatRow[], pick: (r: StatRow) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.yearMonth, (m.get(r.yearMonth) ?? 0) + pick(r));
  return m;
}

type ProductLite = { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category: string | null };

// ───────────────────────── 품목 분석 ─────────────────────────

export type ProductAnalysis =
  | {
      ok: true;
      basis: AnalysisBasis;
      product: ProductLite;
      stock: AvailableStock;
      days: DaysOfStock;
      trend: { yearMonth: string; production: number; shipment: number; returns: number }[];
      returnsTotal: number;
      normalTotal: number;
      seasonal: SeasonalRow[];
      yearly: YearRow[];
      lags: LagRow[];
      best: LagRow | null;
      currentMonth: number;
      seasonRange: { from: string; to: string } | null;
    }
  | { ok: false; reason: "NOT_FOUND" | "NO_PRODUCTION" | "NO_SHIPMENT"; product?: ProductLite };

export async function getProductAnalysis(code: string, seg: Segment, now = new Date()): Promise<ProductAnalysis> {
  const product = await prisma.product.findUnique({
    where: { code },
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
  });
  if (!product) return { ok: false, reason: "NOT_FOUND" };
  const [rows, basis] = await Promise.all([prisma.monthlyStat.findMany({ where: { productCode: code }, select: STAT_SELECT }), getAnalysisBasis()]);
  if (rows.reduce((s, r) => s + r.qtyProducedBox, 0) <= 0) return { ok: false, reason: "NO_PRODUCTION", product };
  if (rows.reduce((s, r) => s + r.qtyNormalBox, 0) <= 0) return { ok: false, reason: "NO_SHIPMENT", product };

  const prodMap = series(rows, (r) => r.qtyProducedBox);
  const shipMap = series(rows, (r) => shipOf(r, seg));
  const retMap = series(rows, (r) => r.qtyReturnBox);

  // 추이: 출고 자료 마지막 달까지 24개월
  const lastYm = basis.salesCoverage?.to ?? rows.map((r) => r.yearMonth).sort().at(-1)!;
  const trendMonths = monthRange(shiftMonth(lastYm, -(TREND_MONTHS - 1)), lastYm);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const trend = trendMonths.map((ym) => ({
    yearMonth: ym,
    production: r1(prodMap.get(ym) ?? 0),
    shipment: r1(shipMap.get(ym) ?? 0),
    returns: r1(retMap.get(ym) ?? 0),
  }));

  // 5년 평균 계절지수 (자료 범위로 자름) + 연도별 지수
  const sm = seasonMonths(basis.salesCoverage);
  const seasonal = seasonalIndex(sm, fillSeries(sm, shipMap));
  const yearly = yearlySeasonal(sm, coveredSeries(sm, shipMap, basis.salesCoverage));

  // 시차 상관: 생산·출고 자료 범위의 합집합 달력, 각자 범위 밖은 null
  const um = unionMonths(basis.productionCoverage, basis.salesCoverage);
  const lags = lagCorrelationsCalendar(
    coveredSeries(um, prodMap, basis.productionCoverage),
    coveredSeries(um, shipMap, basis.salesCoverage),
    MAX_LAG,
  );

  const [stocks, rates] = await Promise.all([computeForProducts([code]), getShipmentRates([code])]);
  const stock = stocks.get(code)!;
  const seoulMonth = Number(new Date(now.getTime() + 9 * 3600_000).toISOString().slice(5, 7));
  return {
    ok: true,
    basis,
    product,
    stock,
    days: daysOfStock(stock, rates.get(code) ?? null, rates.basisTo),
    trend,
    returnsTotal: r1(trend.reduce((s, t) => s + t.returns, 0)),
    normalTotal: r1(trend.reduce((s, t) => s + t.shipment, 0)),
    seasonal,
    yearly,
    lags,
    best: bestLag(lags),
    currentMonth: seoulMonth,
    seasonRange: sm.length ? { from: sm[0], to: sm[sm.length - 1] } : null,
  };
}

// ───────────────────────── 전체 요약 ─────────────────────────

export type SeasonalTopRow = { code: string; name: string; peakMonth: number; peakIndex: number; stock: AvailableStock; days: DaysOfStock };

export async function getOverview(seg: Segment) {
  const [rows, codes, basis] = await Promise.all([
    prisma.monthlyStat.findMany({ select: STAT_SELECT }),
    intersectionCodes(),
    getAnalysisBasis(),
  ]);
  const sm = seasonMonths(basis.salesCoverage);

  const totalShip = new Map<string, number>();
  const totalProd = new Map<string, number>();
  const totalRet = new Map<string, number>();
  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!codes.has(r.productCode)) continue;
    const v = shipOf(r, seg);
    totalShip.set(r.yearMonth, (totalShip.get(r.yearMonth) ?? 0) + v);
    totalProd.set(r.yearMonth, (totalProd.get(r.yearMonth) ?? 0) + r.qtyProducedBox);
    totalRet.set(r.yearMonth, (totalRet.get(r.yearMonth) ?? 0) + r.qtyReturnBox);
    let m = byProduct.get(r.productCode);
    if (!m) byProduct.set(r.productCode, (m = new Map()));
    m.set(r.yearMonth, v);
  }
  const totalSeries = sm.map((ym) => ({ yearMonth: ym, shipment: Math.round(totalShip.get(ym) ?? 0), returns: Math.round(totalRet.get(ym) ?? 0) }));
  const totalSeasonal = seasonalIndex(sm, totalSeries.map((t) => t.shipment));
  const totalYearly = yearlySeasonal(sm, coveredSeries(sm, totalShip, basis.salesCoverage));
  const um = unionMonths(basis.productionCoverage, basis.salesCoverage);
  const totalLags = lagCorrelationsCalendar(
    coveredSeries(um, totalProd, basis.productionCoverage),
    coveredSeries(um, totalShip, basis.salesCoverage),
    MAX_LAG,
  );

  const candidates: { code: string; peakMonth: number; peakIndex: number }[] = [];
  for (const [code, m] of byProduct) {
    const s = fillSeries(sm, m);
    if (s.filter((v) => v > 0).length < MIN_ACTIVE_MONTHS) continue;
    let peak: SeasonalRow | null = null;
    for (const r of seasonalIndex(sm, s)) if (r.index !== null && (peak === null || r.index > (peak.index as number))) peak = r;
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
    basis,
    intersection: codes.size,
    eligible: candidates.length,
    totalSeries,
    totalSeasonal,
    totalYearly,
    totalLags,
    totalBest: bestLag(totalLags),
    returnsTotal: totalSeries.reduce((s, t) => s + t.returns, 0),
    normalTotal: totalSeries.reduce((s, t) => s + t.shipment, 0),
    top: topRows,
    seasonRange: sm.length ? { from: sm[0], to: sm[sm.length - 1] } : null,
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
