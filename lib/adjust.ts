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
  orderId: number | null; // (출고) 이행한 수주 id
};

/** 아직 출고로 이행되지 않은 수주 (미취소, 연결된 미취소 출고 없음) — 출고 입력 시 선택용 */
export type OpenOrder = { id: number; qtyBox: number; memo: string | null; createdAt: string };
export async function listOpenOrders(productCode: string): Promise<OpenOrder[]> {
  const orders = await prisma.stockAdjustment.findMany({
    where: { productCode, reason: "ORDER", cancelledAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, qtyBox: true, memo: true, createdAt: true, shipments: { where: { cancelledAt: null }, select: { id: true } } },
  });
  return orders
    .filter((o) => o.shipments.length === 0)
    .map((o) => ({ id: o.id, qtyBox: o.qtyBox, memo: o.memo, createdAt: o.createdAt.toISOString() }));
}

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
  orderId: number | null;
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
    orderId: r.orderId,
  };
}
