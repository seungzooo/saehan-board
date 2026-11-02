/**
 * F3 조회용 데이터 접근. 가용재고는 저장하지 않고 매번 computeAvailableStock으로 계산한다.
 */
import { computeAvailableStock, type AvailableStock } from "@/lib/availableStock";
import { prisma } from "@/lib/db";

export type StockRow = {
  code: string;
  name: string;
  capacity: string | null;
  packUnit: string;
  unitsPerBox: number;
  stock: AvailableStock;
};

const SEARCH_LIMIT = 50;

/** 최근 재고 업로드 batch (기준점). 없으면 null */
export async function getLatestStockBatch() {
  return prisma.uploadBatch.findFirst({ where: { kind: "STOCK" }, orderBy: { uploadedAt: "desc" } });
}

/**
 * 불량 차감 리셋 시점: 가장 최근 "사후 불량 반영됨"(defectApplied) 재고 배치의 반영 시각.
 * 없으면 null (불량은 전부 누적).
 */
export async function getDefectResetAt(): Promise<Date | null> {
  const b = await prisma.uploadBatch.findFirst({
    where: { kind: "STOCK", defectApplied: true },
    orderBy: { uploadedAt: "desc" },
    select: { uploadedAt: true },
  });
  return b?.uploadedAt ?? null;
}

/** 재고 기준 정보 (화면 헤더·홈 타일 공용) */
export type StockBasis = { uploadedAt: Date; stockAsOf: Date | null; batchId: string } | null;
export async function getStockBasis(): Promise<StockBasis> {
  const b = await getLatestStockBatch();
  return b ? { uploadedAt: b.uploadedAt, stockAsOf: b.stockAsOf, batchId: b.id } : null;
}

/** 품목명·코드 부분일치 검색 → 가용재고 포함 행. 공백으로 나눈 단어 모두 포함(AND) */
export async function searchStock(query: string): Promise<{ rows: StockRow[]; truncated: boolean }> {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { rows: [], truncated: false };

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: terms.map((t) => ({
        OR: [{ name: { contains: t, mode: "insensitive" } }, { code: { contains: t, mode: "insensitive" } }],
      })),
    },
    orderBy: [{ name: "asc" }],
    take: SEARCH_LIMIT + 1,
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true },
  });
  const truncated = products.length > SEARCH_LIMIT;
  const page = products.slice(0, SEARCH_LIMIT);
  const stocks = await computeForProducts(page.map((p) => p.code));
  return { rows: page.map((p) => ({ ...p, stock: stocks.get(p.code)! })), truncated };
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
      select: { productCode: true, qtyBox: true, reason: true, createdAt: true, cancelledAt: true },
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

/** 품목 상세: 제품 + 가용재고 + 변동 이력(최근 100건, 취소 포함) */
export async function getProductDetail(code: string) {
  const product = await prisma.product.findUnique({ where: { code } });
  if (!product) return null;
  const [stocks, history] = await Promise.all([
    computeForProducts([code]),
    prisma.stockAdjustment.findMany({
      where: { productCode: code },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  return { product, stock: stocks.get(code)!, history };
}

/** 최근 재고 업로드에 있는 품목 중 가용재고 ≤ threshold. 가용재고 오름차순 */
export async function listLowStock(threshold: number): Promise<StockRow[]> {
  const batch = await getLatestStockBatch();
  if (!batch) return [];
  const products = await prisma.product.findMany({
    where: { isActive: true, snapshots: { some: { batchId: batch.id } } },
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true },
  });
  const stocks = await computeForProducts(products.map((p) => p.code));
  return products
    .map((p) => ({ ...p, stock: stocks.get(p.code)! }))
    .filter((r) => r.stock.available !== null && r.stock.available <= threshold)
    .sort((a, b) => (a.stock.available ?? 0) - (b.stock.available ?? 0));
}
