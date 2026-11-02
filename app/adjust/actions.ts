"use server";

import { type AdjustmentItem, listOpenOrders, type OpenOrder, toItem } from "@/lib/adjust";
import type { AdjustmentReason, AvailableStock } from "@/lib/availableStock";
import { prisma } from "@/lib/db";
import { computeForProducts } from "@/lib/stock";
import { revalidatePath } from "next/cache";

/** 로그인 없음(F8 삭제). 입력자는 고정값으로 기록 */
const ACTOR = "담당자";

/** F2에서 입력 가능한 사유. 수주(ORDER)는 선차감, 그 수주의 출고를 등록하며 연결하면 수주 차감이 해제된다 */
const INPUT_REASONS: AdjustmentReason[] = ["SHIPMENT", "DEFECT", "ORDER", "OTHER"];

export type ProductHit = {
  code: string;
  name: string;
  capacity: string | null;
  packUnit: string;
  unitsPerBox: number;
  category: string | null;
};

export async function searchProductsAction(q: string): Promise<ProductHit[]> {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return prisma.product.findMany({
    where: {
      isActive: true,
      AND: terms.map((t) => ({
        OR: [{ name: { contains: t, mode: "insensitive" } }, { code: { contains: t, mode: "insensitive" } }],
      })),
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
  });
}

export async function listOpenOrdersAction(productCode: string): Promise<OpenOrder[]> {
  return listOpenOrders(productCode);
}

export type SaveResult = { ok: true; item: AdjustmentItem; stock: AvailableStock } | { ok: false; message: string };

export async function createAdjustmentAction(input: {
  productCode: string;
  qtyBox: number;
  reason: string;
  memo?: string;
  orderId?: number | null; // reason=SHIPMENT일 때 이행한 수주
}): Promise<SaveResult> {
  const qty = Number(input.qtyBox);
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: "수량은 1 이상의 정수여야 합니다." };
  if (!(INPUT_REASONS as string[]).includes(input.reason)) return { ok: false, message: "사유가 잘못되었습니다." };
  const product = await prisma.product.findUnique({ where: { code: input.productCode }, select: { code: true, name: true } });
  if (!product) return { ok: false, message: "품목을 찾을 수 없습니다." };

  let orderId: number | null = null;
  if (input.reason === "SHIPMENT" && input.orderId != null) {
    const order = await prisma.stockAdjustment.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        productCode: true,
        reason: true,
        cancelledAt: true,
        shipments: { where: { cancelledAt: null }, select: { id: true } },
      },
    });
    if (!order || order.reason !== "ORDER" || order.productCode !== product.code) {
      return { ok: false, message: "연결할 수주를 찾을 수 없습니다." };
    }
    if (order.cancelledAt) return { ok: false, message: "취소된 수주입니다." };
    if (order.shipments.length > 0) return { ok: false, message: "이미 출고로 이행된 수주입니다." };
    orderId = order.id;
  }

  const memo = input.memo?.trim() || null;
  const row = await prisma.stockAdjustment.create({
    data: { productCode: product.code, qtyBox: qty, reason: input.reason, memo, createdBy: ACTOR, orderId },
  });
  const stock = (await computeForProducts([product.code])).get(product.code)!;
  revalidate(product.code);
  return { ok: true, item: toItem({ ...row, product }), stock };
}

export type CancelResult = { ok: true; item: AdjustmentItem; stock: AvailableStock } | { ok: false; message: string };

export async function cancelAdjustmentAction(id: number): Promise<CancelResult> {
  const existing = await prisma.stockAdjustment.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
  if (!existing) return { ok: false, message: "해당 변동이 없습니다." };
  if (existing.cancelledAt) return { ok: false, message: "이미 취소된 변동입니다." };
  const row = await prisma.stockAdjustment.update({
    where: { id },
    data: { cancelledAt: new Date() },
    include: { product: { select: { name: true } } },
  });
  const stock = (await computeForProducts([row.productCode])).get(row.productCode)!;
  revalidate(row.productCode);
  return { ok: true, item: toItem(row), stock };
}

function revalidate(code: string) {
  revalidatePath("/");
  revalidatePath("/stock");
  revalidatePath(`/stock/${encodeURIComponent(code)}`);
  revalidatePath("/adjust");
}
