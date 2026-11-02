/** 홈 대시보드 지표. 전부 조회 시점 계산 — 저장하지 않는다 */
import { prisma } from "@/lib/db";
import { seoulParts } from "@/lib/format";
import { computeForProducts, getLatestStockBatch } from "@/lib/stock";

export const LOW_STOCK_THRESHOLD = 10;

/** 오늘(Asia/Seoul) 00:00 의 UTC 시각 */
export function seoulDayStart(now = new Date()): Date {
  const { y, m, d } = seoulParts(now);
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
}

export async function getDashboard() {
  const batch = await getLatestStockBatch();
  const [productCount, todayAdjustments, recentUploads, lowStockCount] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    prisma.stockAdjustment.count({ where: { createdAt: { gte: seoulDayStart() }, cancelledAt: null } }),
    prisma.uploadBatch.findMany({ orderBy: { uploadedAt: "desc" }, take: 3 }),
    countLowStock(batch?.id ?? null),
  ]);
  return { batch, productCount, todayAdjustments, recentUploads, lowStockCount };
}

/** 최근 재고 업로드에 있는 품목 중 가용재고 ≤ 임계값인 품목 수 */
async function countLowStock(batchId: string | null): Promise<number> {
  if (!batchId) return 0;
  const codes = (await prisma.stockSnapshot.findMany({ where: { batchId }, select: { productCode: true } })).map(
    (s) => s.productCode,
  );
  const stocks = await computeForProducts(codes);
  let n = 0;
  for (const s of stocks.values()) if (s.available <= LOW_STOCK_THRESHOLD) n++;
  return n;
}
