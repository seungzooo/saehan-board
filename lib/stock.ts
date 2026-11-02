/**
 * F3 조회용 데이터 접근. 가용재고는 저장하지 않고 매번 computeAvailableStock으로 계산한다.
 */
import { computeAvailableStock, defectResetFromEnv, type AvailableStock } from "@/lib/availableStock";
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
  const [snapshots, adjustments] = await Promise.all([
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
  ]);
  const snapByCode = new Map(snapshots.map((s) => [s.productCode, s]));
  const adjByCode = new Map<string, typeof adjustments>();
  for (const a of adjustments) {
    const list = adjByCode.get(a.productCode) ?? [];
    list.push(a);
    adjByCode.set(a.productCode, list);
  }
  const opts = { defectResetOnUpload: defectResetFromEnv() };
  for (const code of codes) {
    const snap = snapByCode.get(code);
    result.set(
      code,
      computeAvailableStock(snap ? { qtyBox: snap.qtyBox, uploadedAt: snap.uploadedAt } : null, adjByCode.get(code) ?? [], opts),
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
