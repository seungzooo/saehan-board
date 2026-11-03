/** 홈 대시보드 지표. 전부 조회 시점 계산 — 저장하지 않는다 */
import { prisma } from "@/lib/db";
import { seoulParts } from "@/lib/format";
import { getLatestStockBatch, listLowStock } from "@/lib/stock";

/** 오늘(Asia/Seoul) 00:00 의 UTC 시각 */
export function seoulDayStart(now = new Date()): Date {
  const { y, m, d } = seoulParts(now);
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
}

export async function getDashboard() {
  const batch = await getLatestStockBatch();
  const [managed, checked, todayAdjustments, lastAdjustment, recentUploads, low] = await Promise.all([
    prisma.product.count({ where: { isActive: true } }),
    batch ? prisma.stockSnapshot.count({ where: { batchId: batch.id, product: { isActive: true } } }) : Promise.resolve(0),
    prisma.stockAdjustment.count({ where: { createdAt: { gte: seoulDayStart() }, cancelledAt: null } }),
    prisma.stockAdjustment.findFirst({ where: { cancelledAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.uploadBatch.findMany({ where: { revertedAt: null }, orderBy: { uploadedAt: "desc" }, take: 3 }),
    listLowStock(),
  ]);
  return {
    batch,
    managed,
    checked,
    unchecked: managed - checked,
    todayAdjustments,
    lastAdjustmentAt: lastAdjustment?.createdAt ?? null,
    recentUploads,
    lowStockCount: low.length,
    lowBasisTo: low[0]?.days.basisTo ?? null,
  };
}
