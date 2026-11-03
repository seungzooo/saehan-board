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
import { getMonthlyUnits } from "./shipments";
import { effectiveCompletion } from "./completion";
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
/**
 * 계절지수(5년 평균·상위 10)의 분석 기간 = 출고 자료 범위의 끝(집계 완료 월로 자름)에서 거슬러 SEASON_YEARS년(60개 달).
 * 고정 연도를 쓰지 않는다 — 새 출고실적을 같은 업로드 경로로 올려 집계 완료 월이 늘어나면 기간도 따라 이동한다.
 */
export const SEASON_YEARS = 5;
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
  qtyProduced: number;
  qtyProducedBox: number;
  qtyNormalBox: number;
  qtyNormalB2B: number;
  qtyNormalB2C: number;
  qtyReturnBox: number;
};
const STAT_SELECT = {
  productCode: true,
  yearMonth: true,
  qtyProduced: true,
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
  const [pMaxYm, batches] = await Promise.all([
    prisma.productionHistory.aggregate({ _max: { yearMonth: true } }),
    prisma.uploadBatch.findMany({
      where: { kind: { in: ["SALES", "PRODUCTION"] } },
      select: { id: true, kind: true, fileName: true, uploadedAt: true, completeThrough: true, revertedAt: true },
    }),
  ]);
  const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  // 시차 상관의 자료 범위 끝 = 실제 마지막 달과 그 실적의 집계 완료 월 중 이른 쪽
  const clip = (to: string, done: string | null | undefined) => (done && done < to ? done : to);
  const salesDone = effectiveCompletion(batches, "SALES")?.completeThrough ?? null;
  const prodDone = effectiveCompletion(batches, "PRODUCTION")?.completeThrough ?? null;
  return {
    shipmentTo: iso(s._max.date),
    productionTo: iso(p._max.date),
    salesCoverage:
      sAll._min.yearMonth && sAll._max.yearMonth ? { from: sAll._min.yearMonth, to: clip(sAll._max.yearMonth, salesDone) } : null,
    productionCoverage:
      p._min.yearMonth && pMaxYm._max.yearMonth ? { from: p._min.yearMonth, to: clip(pMaxYm._max.yearMonth, prodDone) } : null,
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
export function seasonMonths(cov: Coverage): string[] {
  if (!cov) return [];
  const start = shiftMonth(cov.to, -(SEASON_YEARS * 12 - 1));
  const from = cov.from > start ? cov.from : start;
  return from <= cov.to ? monthRange(from, cov.to) : [];
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

/** 실적에서만 나오는 품목 분석 — 캐시 대상 (재고·이번 달은 제외) */
export type ProductAnalysisStatic =
  | {
      ok: true;
      basis: AnalysisBasis;
      product: ProductLite;
      /** 최근 24개월 생산·정상 판매·반품, 모두 낱개 (화면에서 박스 환산 여부 결정) */
      trend: { yearMonth: string; production: number; shipment: number; returns: number }[];
      returnsTotal: number; // 낱개
      normalTotal: number; // 낱개
      seasonal: SeasonalRow[];
      yearly: YearRow[];
      lags: LagRow[];
      best: LagRow | null;
      seasonRange: { from: string; to: string } | null;
      lagRange: { from: string; to: string } | null;
    }
  | { ok: false; reason: "NOT_FOUND" | "NO_PRODUCTION" | "NO_SHIPMENT"; product?: ProductLite };

export async function getProductAnalysisStatic(code: string, seg: Segment = "ALL"): Promise<ProductAnalysisStatic> {
  const product = await prisma.product.findUnique({
    where: { code },
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
  });
  if (!product) return { ok: false, reason: "NOT_FOUND" };
  const [rows, basis, units] = await Promise.all([
    prisma.monthlyStat.findMany({ where: { productCode: code }, select: STAT_SELECT }),
    getAnalysisBasis(),
    getMonthlyUnits(code),
  ]);
  if (rows.reduce((s, r) => s + r.qtyProducedBox, 0) <= 0) return { ok: false, reason: "NO_PRODUCTION", product };
  if (rows.reduce((s, r) => s + r.qtyNormalBox, 0) <= 0) return { ok: false, reason: "NO_SHIPMENT", product };

  // 계절지수·시차 상관은 비율·상관이라 단위와 무관 — MonthlyStat 박스 환산값을 그대로 쓴다
  const prodMap = series(rows, (r) => r.qtyProducedBox);
  const shipMap = series(rows, (r) => shipOf(r, seg));
  // 추이 그래프·합계는 낱개 (생산 A급 수량, 정상·반품 출고수량)
  const prodUnits = series(rows, (r) => r.qtyProduced);

  // 추이: 출고 자료 마지막 달까지 24개월
  const lastYm = basis.salesCoverage?.to ?? rows.map((r) => r.yearMonth).sort().at(-1)!;
  const trendMonths = monthRange(shiftMonth(lastYm, -(TREND_MONTHS - 1)), lastYm);
  const trend = trendMonths.map((ym) => ({
    yearMonth: ym,
    production: prodUnits.get(ym) ?? 0,
    shipment: units.normal.get(ym) ?? 0,
    returns: units.returns.get(ym) ?? 0,
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

  return {
    ok: true,
    basis,
    product,
    trend,
    returnsTotal: trend.reduce((s, t) => s + t.returns, 0),
    normalTotal: trend.reduce((s, t) => s + t.shipment, 0),
    seasonal,
    yearly,
    lags,
    best: bestLag(lags),
    seasonRange: sm.length ? { from: sm[0], to: sm[sm.length - 1] } : null,
    lagRange: um.length ? { from: um[0], to: um[um.length - 1] } : null,
  };
}

/** 실시간 재고·소진일수 (캐시하지 않는다) */
export async function getLiveStock(codes: string[]): Promise<Map<string, { stock: AvailableStock; days: DaysOfStock }>> {
  const [stocks, rates] = await Promise.all([computeForProducts(codes), getShipmentRates(codes)]);
  const out = new Map<string, { stock: AvailableStock; days: DaysOfStock }>();
  for (const c of codes) {
    const stock = stocks.get(c)!;
    out.set(c, { stock, days: daysOfStock(stock, rates.get(c) ?? null, rates.basisTo) });
  }
  return out;
}

/** 서울 기준 이번 달 (1~12) */
export function seoulMonth(now = new Date()): number {
  return Number(new Date(now.getTime() + 9 * 3600_000).toISOString().slice(5, 7));
}

// ───────────────────────── 전체 요약 ─────────────────────────

export type SeasonalTopRow = { code: string; name: string; peakMonth: number; peakIndex: number };

export async function getOverview(seg: Segment) {
  const [rows, codes, basis] = await Promise.all([
    prisma.monthlyStat.findMany({ select: STAT_SELECT }),
    intersectionCodes(),
    getAnalysisBasis(),
  ]);
  const sm = seasonMonths(basis.salesCoverage);

  // 시차 상관 = 생산·판매를 함께 비교 → 교집합 품번만 합산
  const interShip = new Map<string, number>();
  const interProd = new Map<string, number>();
  // 계절지수 상위 10 = 판매만 보는 분석 → 전 품목
  const byProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const v = shipOf(r, seg);
    let m = byProduct.get(r.productCode);
    if (!m) byProduct.set(r.productCode, (m = new Map()));
    m.set(r.yearMonth, v);
    if (!codes.has(r.productCode)) continue;
    interShip.set(r.yearMonth, (interShip.get(r.yearMonth) ?? 0) + v);
    interProd.set(r.yearMonth, (interProd.get(r.yearMonth) ?? 0) + r.qtyProducedBox);
  }
  const um = unionMonths(basis.productionCoverage, basis.salesCoverage);
  const totalLags = lagCorrelationsCalendar(
    coveredSeries(um, interProd, basis.productionCoverage),
    coveredSeries(um, interShip, basis.salesCoverage),
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
  const products = await prisma.product.findMany({ where: { code: { in: top.map((t) => t.code) } }, select: { code: true, name: true } });
  const nameOf = new Map(products.map((p) => [p.code, p.name]));
  const topRows: SeasonalTopRow[] = top.map((t) => ({ ...t, name: nameOf.get(t.code) ?? t.code }));

  return {
    basis,
    intersection: codes.size,
    eligible: candidates.length,
    lagRange: um.length ? { from: um[0], to: um[um.length - 1] } : null,
    totalLags,
    totalBest: bestLag(totalLags),
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
