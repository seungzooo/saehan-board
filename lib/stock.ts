/**
 * F3 조회용 데이터 접근. 가용재고는 저장하지 않고 매번 computeAvailableStock으로 계산한다.
 */
import { ANALYSIS_SALES_TYPE, ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { LOW_DAYS_THRESHOLD, SHIPMENT_WINDOW_DAYS } from "@/config/stock";
import { computeAvailableStock, cutoffOf, type AvailableStock } from "@/lib/availableStock";
import { prisma } from "@/lib/db";
import { capacityQueryVariants, rankProducts } from "@/lib/search";

export type StockRow = {
  code: string;
  name: string;
  capacity: string | null;
  packUnit: string;
  unitsPerBox: number;
  category: string | null;
  stock: AvailableStock;
  days: DaysOfStock;
};

/** 예상 소진일수. days=null → "산정 불가"(출고 이력 없음 또는 재고 확인 필요) */
export type DaysOfStock = { days: number | null; avgPerDay: number | null; basisTo: string | null };

const SEARCH_LIMIT = 50;

/** 최근 재고 업로드 batch (기준점). 복구된 배치는 제외. 없으면 null */
export async function getLatestStockBatch() {
  return prisma.uploadBatch.findFirst({ where: { kind: "STOCK", revertedAt: null }, orderBy: { uploadedAt: "desc" } });
}

/**
 * 불량 차감 리셋 시점: 가장 최근 "사후 불량 반영됨"(defectApplied) 재고 배치의 반영 시각.
 * 없으면 null (불량은 전부 누적).
 */
export async function getDefectResetAt(): Promise<Date | null> {
  const b = await prisma.uploadBatch.findFirst({
    where: { kind: "STOCK", defectApplied: true, revertedAt: null },
    orderBy: { uploadedAt: "desc" },
    select: { uploadedAt: true, stockAsOf: true },
  });
  return b ? cutoffOf(b) : null;
}

/** 재고 기준 정보 (화면 헤더·홈 타일 공용) */
export type StockBasis = { uploadedAt: Date; stockAsOf: Date | null; batchId: string } | null;
export async function getStockBasis(): Promise<StockBasis> {
  const b = await getLatestStockBatch();
  return b ? { uploadedAt: b.uploadedAt, stockAsOf: b.stockAsOf, batchId: b.id } : null;
}

/**
 * 품목명·코드 부분일치 검색 → 가용재고 포함 행. 공백으로 나눈 단어 모두 포함(AND).
 * 용량 인식: "2L"은 capacity 2000·이름의 2000ml도 후보에 넣고, 순위는 lib/search.ts rankProducts
 * (품번 정확 일치 → 용량 일치 → 온전한 토큰 → 부분 일치).
 */
export async function searchStock(query: string): Promise<{ rows: StockRow[]; truncated: boolean }> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { rows: [], truncated: false };

  const candidates = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: terms.map((t) => {
        const variants = capacityQueryVariants(t);
        return {
          OR: [
            { name: { contains: t, mode: "insensitive" as const } },
            { code: { contains: t, mode: "insensitive" as const } },
            ...(variants.length ? [{ capacity: { in: variants } }] : []),
            ...variants.filter((v) => v !== t).map((v) => ({ name: { contains: v, mode: "insensitive" as const } })),
          ],
        };
      }),
    },
    take: 400,
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
  });
  const ranked = rankProducts(candidates, query);
  const truncated = ranked.length > SEARCH_LIMIT;
  const page = ranked.slice(0, SEARCH_LIMIT);
  return { rows: await toRows(page), truncated };
}

type ProductLite = { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category: string | null };
const PRODUCT_LITE = { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true } as const;

async function toRows(products: ProductLite[]): Promise<StockRow[]> {
  const codes = products.map((p) => p.code);
  const [stocks, rates] = await Promise.all([computeForProducts(codes), getShipmentRates(codes)]);
  return products.map((p) => {
    const stock = stocks.get(p.code)!;
    return { ...p, stock, days: daysOfStock(stock, rates.get(p.code) ?? null, rates.basisTo) };
  });
}

/**
 * 최근 30일 일평균 출고(박스). 창의 끝은 출고실적의 마지막 날짜(실적 기준일) — "지금" 기준이면
 * 실적 업로드가 늦어진 동안 전부 산정 불가가 되기 때문. basisTo에 그 날짜를 돌려준다.
 */
export async function getShipmentRates(codes: string[]): Promise<Map<string, number> & { basisTo: string | null }> {
  const map = new Map<string, number>() as Map<string, number> & { basisTo: string | null };
  map.basisTo = null;
  if (codes.length === 0) return map;
  const last = await prisma.shipmentHistory.aggregate({ _max: { date: true } });
  const to = last._max.date;
  if (!to) return map;
  const from = new Date(to.getTime() - (SHIPMENT_WINDOW_DAYS - 1) * 86400_000);
  const sums = await prisma.shipmentHistory.groupBy({
    by: ["productCode"],
    where: { productCode: { in: codes }, date: { gte: from, lte: to }, shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE },
    _sum: { qtyBox: true },
  });
  for (const s of sums) map.set(s.productCode, (s._sum.qtyBox ?? 0) / SHIPMENT_WINDOW_DAYS);
  map.basisTo = to.toISOString().slice(0, 10);
  return map;
}

export function daysOfStock(stock: AvailableStock, avgPerDay: number | null, basisTo: string | null): DaysOfStock {
  if (stock.available === null || avgPerDay === null || avgPerDay <= 0) return { days: null, avgPerDay, basisTo };
  return { days: Math.max(0, stock.available) / avgPerDay, avgPerDay, basisTo };
}

export function isLowStock(d: DaysOfStock): boolean {
  return d.days !== null && d.days <= LOW_DAYS_THRESHOLD;
}

/** 최근 재고 파일에 없는(미확인) 관리 대상 품목. 이름순, limit 건 */
export async function listUnchecked(limit = 200): Promise<{ rows: ProductLite[]; total: number }> {
  const batch = await getLatestStockBatch();
  const where = batch
    ? { isActive: true, snapshots: { none: { batchId: batch.id } } }
    : { isActive: true };
  const [rows, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: "asc" }, take: limit, select: PRODUCT_LITE }),
    prisma.product.count({ where }),
  ]);
  return { rows, total };
}

/** 여러 품목의 가용재고를 한 번에 계산 (쿼리 3개) */
export async function computeForProducts(codes: string[]): Promise<Map<string, AvailableStock>> {
  const result = new Map<string, AvailableStock>();
  if (codes.length === 0) return result;
  const batch = await getLatestStockBatch();
  const [snapshots, adjustments, defectResetAt] = await Promise.all([
    batch
      ? prisma.stockSnapshot.findMany({
          where: { batchId: batch.id, productCode: { in: codes } },
          select: { productCode: true, qtyBox: true, uploadedAt: true },
        })
      : Promise.resolve([]),
    prisma.stockAdjustment.findMany({
      where: { productCode: { in: codes } },
      select: { id: true, productCode: true, qtyBox: true, reason: true, createdAt: true, cancelledAt: true, orderId: true },
    }),
    getDefectResetAt(),
  ]);
  const snapByCode = new Map(snapshots.map((s) => [s.productCode, s]));
  const adjByCode = new Map<string, typeof adjustments>();
  for (const a of adjustments) {
    const list = adjByCode.get(a.productCode) ?? [];
    list.push(a);
    adjByCode.set(a.productCode, list);
  }
  for (const code of codes) {
    const snap = snapByCode.get(code);
    result.set(
      code,
      computeAvailableStock(
        snap ? { qtyBox: snap.qtyBox, uploadedAt: snap.uploadedAt, stockAsOf: batch?.stockAsOf ?? null, defectResetAt } : null,
        adjByCode.get(code) ?? [],
      ),
    );
  }
  return result;
}

/** 품목 상세: 제품 + 가용재고 + 소진일수 + 변동 이력(최근 100건, 취소 포함) */
export async function getProductDetail(code: string) {
  const product = await prisma.product.findUnique({ where: { code } });
  if (!product) return null;
  const [stocks, rates, history] = await Promise.all([
    computeForProducts([code]),
    getShipmentRates([code]),
    prisma.stockAdjustment.findMany({
      where: { productCode: code },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const stock = stocks.get(code)!;
  return { product, stock, days: daysOfStock(stock, rates.get(code) ?? null, rates.basisTo), history };
}

/** 확인된 품목(최근 재고 파일에 있음) 중 예상 소진일수 ≤ LOW_DAYS_THRESHOLD. 소진일수 오름차순 */
export async function listLowStock(): Promise<StockRow[]> {
  const batch = await getLatestStockBatch();
  if (!batch) return [];
  const products = await prisma.product.findMany({
    where: { isActive: true, snapshots: { some: { batchId: batch.id } } },
    select: PRODUCT_LITE,
  });
  const rows = await toRows(products);
  return rows.filter((r) => isLowStock(r.days)).sort((a, b) => (a.days.days ?? 0) - (b.days.days ?? 0));
}

/** 최근 30일 일별 출고(박스, 정상·내수). 끝 = 출고실적 마지막 날짜. 스파크라인용 */
export async function getDailyShipments(code: string): Promise<{ basisTo: string | null; days: { date: string; qtyBox: number }[] }> {
  const last = await prisma.shipmentHistory.aggregate({ _max: { date: true } });
  const to = last._max.date;
  if (!to) return { basisTo: null, days: [] };
  const from = new Date(to.getTime() - (SHIPMENT_WINDOW_DAYS - 1) * 86400_000);
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["date"],
    where: { productCode: code, date: { gte: from, lte: to }, shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE },
    _sum: { qtyBox: true },
  });
  const byDay = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r._sum.qtyBox ?? 0]));
  const days: { date: string; qtyBox: number }[] = [];
  for (let i = 0; i < SHIPMENT_WINDOW_DAYS; i++) {
    const d = new Date(from.getTime() + i * 86400_000).toISOString().slice(0, 10);
    days.push({ date: d, qtyBox: Math.round((byDay.get(d) ?? 0) * 10) / 10 });
  }
  return { basisTo: to.toISOString().slice(0, 10), days };
}

export type ListFilter = "all" | "checked" | "unchecked";
export const LIST_PAGE_SIZE = 50;

/** 대시보드 숫자 → 목록: 전체 / 확인됨(최근 재고 파일에 있음) / 미확인. 이름순, 50개씩 */
export async function listByFilter(filter: ListFilter, page: number): Promise<{ rows: StockRow[]; total: number }> {
  const batch = await getLatestStockBatch();
  const where =
    filter === "checked"
      ? batch
        ? { isActive: true, snapshots: { some: { batchId: batch.id } } }
        : { isActive: true, code: { in: [] as string[] } }
      : filter === "unchecked" && batch
        ? { isActive: true, snapshots: { none: { batchId: batch.id } } }
        : { isActive: true };
  const [products, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * LIST_PAGE_SIZE, take: LIST_PAGE_SIZE, select: PRODUCT_LITE }),
    prisma.product.count({ where }),
  ]);
  return { rows: await toRows(products), total };
}
