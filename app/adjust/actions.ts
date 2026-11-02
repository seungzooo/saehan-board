"use server";

import { type AdjustmentItem, toItem } from "@/lib/adjust";
import type { AdjustmentReason, AvailableStock } from "@/lib/availableStock";
import { canAdjust, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeForProducts } from "@/lib/stock";
import { revalidatePath } from "next/cache";

/** F2에서 입력 가능한 사유. 수주(ORDER)는 F7에서 따로 등록한다 */
const INPUT_REASONS: AdjustmentReason[] = ["SHIPMENT", "DEFECT", "OTHER"];

export type ProductHit = { code: string; name: string; capacity: string | null; packUnit: string; unitsPerBox: number };

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
    select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true },
  });
}

export type SaveResult =
  | { ok: true; item: AdjustmentItem; stock: AvailableStock }
  | { ok: false; message: string };

export async function createAdjustmentAction(input: {
  productCode: string;
  qtyBox: number;
  reason: string;
  memo?: string;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!canAdjust(user)) return { ok: false, message: "변동 입력 권한이 없습니다." };

  const qty = Number(input.qtyBox);
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: "수량은 1 이상의 정수여야 합니다." };
  if (!(INPUT_REASONS as string[]).includes(input.reason)) return { ok: false, message: "사유가 잘못되었습니다." };
  const product = await prisma.product.findUnique({ where: { code: input.productCode }, select: { code: true, name: true } });
  if (!product) return { ok: false, message: "품목을 찾을 수 없습니다." };

  const memo = input.memo?.trim() || null;
  const row = await prisma.stockAdjustment.create({
    data: { productCode: product.code, qtyBox: qty, reason: input.reason, memo, createdBy: user!.loginId },
  });
  const stock = (await computeForProducts([product.code])).get(product.code)!;
  revalidatePath("/stock");
  revalidatePath(`/stock/${encodeURIComponent(product.code)}`);
  revalidatePath("/adjust");
  return { ok: true, item: toItem({ ...row, product }), stock };
}

export type CancelResult = { ok: true; item: AdjustmentItem; stock: AvailableStock } | { ok: false; message: string };

export async function cancelAdjustmentAction(id: number): Promise<CancelResult> {
  const user = await getCurrentUser();
  if (!canAdjust(user)) return { ok: false, message: "취소 권한이 없습니다." };
  const existing = await prisma.stockAdjustment.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
  if (!existing) return { ok: false, message: "해당 변동이 없습니다." };
  if (existing.cancelledAt) return { ok: false, message: "이미 취소된 변동입니다." };
  const row = await prisma.stockAdjustment.update({
    where: { id },
    data: { cancelledAt: new Date() },
    include: { product: { select: { name: true } } },
  });
  const stock = (await computeForProducts([row.productCode])).get(row.productCode)!;
  revalidatePath("/stock");
  revalidatePath(`/stock/${encodeURIComponent(row.productCode)}`);
  revalidatePath("/adjust");
  return { ok: true, item: toItem(row), stock };
}
