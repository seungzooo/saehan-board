/** F2 변동 목록 — 서버 컴포넌트와 서버 액션이 공유 */
import { prisma } from "@/lib/db";

export type AdjustmentItem = {
  id: number;
  productCode: string;
  productName: string;
  qtyBox: number;
  reason: string;
  memo: string | null;
  createdBy: string;
  createdAt: string; // ISO
  cancelledAt: string | null;
};

/** 최근 변동 목록 (페이지 초기 데이터). 취소 포함, 최신순 */
export async function listRecentAdjustments(limit = 50): Promise<AdjustmentItem[]> {
  const rows = await prisma.stockAdjustment.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { product: { select: { name: true } } },
  });
  return rows.map(toItem);
}

export function toItem(r: {
  id: number;
  productCode: string;
  qtyBox: number;
  reason: string;
  memo: string | null;
  createdBy: string;
  createdAt: Date;
  cancelledAt: Date | null;
  product: { name: string };
}): AdjustmentItem {
  return {
    id: r.id,
    productCode: r.productCode,
    productName: r.product.name,
    qtyBox: r.qtyBox,
    reason: r.reason,
    memo: r.memo,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  };
}
