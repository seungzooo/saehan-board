/**
 * F3 조회용 데이터 접근. 가용재고는 저장하지 않고 매번 computeAvailableStock으로 계산한다.
 */
import { ANALYSIS_SALES_TYPE, ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { SHIPMENT_WINDOW_DAYS } from "@/config/stock";
import { computeAvailableStock, type AvailableStock } from "@/lib/availableStock";
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
 * 품목별 불량 차감 리셋 시점: 그 품목이 **파일에 실제로 들어 있던**(이월 아님) "사후 불량 반영됨"(defectApplied) 재고 배치 중
 * 가장 늦은 기준 시각(집계 시각, 없으면 반영 시각). 없으면 그 품목의 불량은 전부 누적.
 * 일부 갱신 파일에 없던 품목은 그 파일이 불량을 반영했다고 볼 수 없으므로 리셋하지 않는다.
 */
export async function getDefectResetAt(codes: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (codes.length === 0) return map;
  const rows = await prisma.stockSnapshot.findMany({
    where: { productCode: { in: codes }, carried: false, batch: { kind: "STOCK", defectApplied: true, revertedAt: null } },
    select: { productCode: true, stockAsOf: true, uploadedAt: true },
  });
  for (const r of rows) {
    const at = r.stockAsOf ?? r.uploadedAt;
    const cur = map.get(r.productCode);
    if (!cur || at > cur) map.set(r.productCode, at);
  }
  return map;
}

/** 재고 기준 정보 (화면 헤더·홈 타일 공용) */
export type StockBasis = { uploadedAt: Date; stockAsOf: Date | null; batchId: string; partial?: boolean } | null;
export async function getStockBasis(): Promise<StockBasis> {
  const b = await getLatestStockBatch();
  return b ? { uploadedAt: b.uploadedAt, stockAsOf: b.stockAsOf, batchId: b.id, partial: b.mode === "MERGE" } : null;
}

/**
 * 품목명·코드 부분일치 검색 → 가용재고 포함 행. 공백으로 나눈 단어 모두 포함(AND).
 * 용량 인식: "2L"은 capacity 2000·이름의 2000ml도 후보에 넣고, 순위는 lib/search.ts rankProducts
 * (품번 정확 일치 → 용량 일치 → 온전한 토큰 → 부분 일치).
 */
export type SearchScope = {
  /** 관리 대상 품번. 주어지면 그 밖(휴면)은 결과에서 빼고 hiddenDormant로 센다 */
  managedCodes?: Set<string> | null;
};

export async function searchStock(
  query: string,
  scope: SearchScope = {},
): Promise<{ rows: StockRow[]; truncated: boolean; hiddenDormant: number; exactDormant: { code: string; name: string } | null }> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { rows: [], truncated: false, hiddenDormant: 0, exactDormant: null };

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
  const managed = scope.managedCodes;
  const visible = managed ? candidates.filter((c) => managed.has(c.code)) : candidates;
  const hidden = managed ? candidates.filter((c) => !managed.has(c.code)) : [];
  const exact = hidden.find((c) => c.code.toLowerCase() === query.trim().toLowerCase()) ?? null;
  const ranked = rankProducts(visible, query);
  const truncated = ranked.length > SEARCH_LIMIT;
  const page = ranked.slice(0, SEARCH_LIMIT);
  return {
    rows: await toRows(page),
    truncated,
    hiddenDormant: hidden.length,
    exactDormant: exact ? { code: exact.code, name: exact.name } : null,
  };
}

type ProductLite = { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number; category: string | null };

async function toRows(products: ProductLite[]): Promise<StockRow[]> {
  const codes = products.map((p) => p.code);
  const [stocks, rates] = await Promise.all([computeForProducts(codes), getShipmentRates(codes)]);
  return products.map((p) => {
    const stock = stocks.get(p.code)!;
    return { ...p, stock, days: daysOfStock(stock, rates.get(p.code) ?? null, rates.basisTo) };
  });
}

/**
 * 최근 30일 일평균 출고(박스). 창의 끝은 정상·내수 출고실적의 마지막 날짜(실적 기준일, 관리 대상 기준월과 같은 기준) — "지금" 기준이면
 * 실적 업로드가 늦어진 동안 전부 산정 불가가 되기 때문. basisTo에 그 날짜를 돌려준다.
 */
export async function getShipmentRates(codes: string[]): Promise<Map<string, number> & { basisTo: string | null }> {
  const map = new Map<string, number>() as Map<string, number> & { basisTo: string | null };
  map.basisTo = null;
  if (codes.length === 0) return map;
  const last = await prisma.shipmentHistory.aggregate({ _max: { date: true }, where: { shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE } });
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



/** 여러 품목의 가용재고를 한 번에 계산 (쿼리 3개) */
export async function computeForProducts(codes: string[]): Promise<Map<string, AvailableStock>> {
  const result = new Map<string, AvailableStock>();
  if (codes.length === 0) return result;
  const batch = await getLatestStockBatch();
  const [snapshots, adjustments, defectResetAt] = await Promise.all([
    batch
      ? prisma.stockSnapshot.findMany({
          where: { batchId: batch.id, productCode: { in: codes } },
          select: { productCode: true, qtyBox: true, uploadedAt: true, stockAsOf: true },
        })
      : Promise.resolve([]),
    prisma.stockAdjustment.findMany({
      where: { productCode: { in: codes } },
      select: { id: true, productCode: true, qtyBox: true, reason: true, createdAt: true, cancelledAt: true, orderId: true },
    }),
    getDefectResetAt(codes),
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
        // 품목별 집계·반영 시각 (일부 갱신으로 이월된 품목은 원래 시각)
        snap ? { qtyBox: snap.qtyBox, uploadedAt: snap.uploadedAt, stockAsOf: snap.stockAsOf, defectResetAt: defectResetAt.get(code) ?? null } : null,
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


/** 최근 30일 일별 출고(박스, 정상·내수). 끝 = 출고실적 마지막 날짜. 스파크라인용 */
export async function getDailyShipments(code: string): Promise<{ basisTo: string | null; days: { date: string; qtyBox: number }[] }> {
  const last = await prisma.shipmentHistory.aggregate({ _max: { date: true }, where: { shipType: ANALYSIS_SHIP_TYPE, salesType: ANALYSIS_SALES_TYPE } });
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

