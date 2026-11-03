"use server";

import { type AdjustmentItem, listOpenOrders, type OpenOrder, toItem } from "@/lib/adjust";
import type { AdjustmentReason, AvailableStock } from "@/lib/availableStock";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { computeForProducts } from "@/lib/stock";
import { requirePin } from "@/lib/pin";
import { isDiscontinued } from "@/lib/search";
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
  /** 목록 오른쪽 작은 표시: "30박스" / "확인 필요" */
  stockLabel?: string;
};

/** 품목별 현재 재고 라벨 — "30박스" 또는 "확인 필요" */
export async function stockLabels(codes: string[]): Promise<Record<string, string>> {
  if (await requirePin()) return {};
  const stocks = await computeForProducts([...new Set(codes)]);
  const out: Record<string, string> = {};
  for (const [code, s] of stocks) out[code] = s.available === null ? "확인 필요" : `${s.available.toLocaleString()}박스`;
  return out;
}

export async function searchProductsAction(q: string): Promise<ProductHit[]> {
  if (await requirePin()) return [];
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits = await prisma.product.findMany({
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
  const labels = await stockLabels(hits.map((h) => h.code));
  // 단종(품명이 "폐기"로 시작)은 맨 아래
  return hits
    .map((h) => ({ ...h, stockLabel: labels[h.code] }))
    .sort((a, b) => Number(isDiscontinued(a.name)) - Number(isDiscontinued(b.name)));
}

export async function listOpenOrdersAction(productCode: string): Promise<OpenOrder[]> {
  if (await requirePin()) return [];
  return listOpenOrders(productCode);
}

/** 품목의 현재 재고 — 변동 입력 화면의 "현재 N → 반영 후 M" 표시용 */
export async function getStockAction(productCode: string): Promise<AvailableStock | null> {
  if (await requirePin()) return null;
  return (await computeForProducts([productCode])).get(productCode) ?? null;
}

export type SaveResult =
  | { ok: true; item: AdjustmentItem; stock: AvailableStock; deduped?: boolean }
  | { ok: false; message: string };

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function createAdjustmentAction(input: {
  productCode: string;
  qtyBox: number;
  reason: string;
  memo?: string;
  orderId?: number | null; // reason=SHIPMENT일 때 이행한 수주
  requestId: string; // 클라이언트가 폼마다 1회 발급 — 연타·동시 입력 멱등
}): Promise<SaveResult> {
  const denied = await requirePin();
  if (denied) return { ok: false, message: denied };
  const qty = Number(input.qtyBox);
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: "수량은 1 이상의 정수여야 합니다." };
  if (!(INPUT_REASONS as string[]).includes(input.reason)) return { ok: false, message: "사유가 잘못되었습니다." };
  if (!REQUEST_ID_RE.test(input.requestId ?? "")) return { ok: false, message: "요청 ID가 없습니다. 화면을 새로고침하세요." };

  // 같은 요청 ID가 이미 저장됐으면 그 결과를 돌려준다 (저장 버튼 연타·재전송)
  const existing = await prisma.stockAdjustment.findUnique({
    where: { requestId: input.requestId },
    include: { product: { select: { name: true } } },
  });
  if (existing) {
    const stock = (await computeForProducts([existing.productCode])).get(existing.productCode)!;
    return { ok: true, item: toItem(existing), stock, deduped: true };
  }

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
  try {
    const row = await prisma.stockAdjustment.create({
      data: { productCode: product.code, qtyBox: qty, reason: input.reason, memo, createdBy: ACTOR, orderId, requestId: input.requestId },
    });
    const stock = (await computeForProducts([product.code])).get(product.code)!;
    revalidate(product.code);
    return { ok: true, item: toItem({ ...row, product }), stock };
  } catch (e) {
    // 동시에 같은 요청이 들어와 unique(requestId) 충돌 → 먼저 저장된 쪽을 돌려준다
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.stockAdjustment.findUnique({
        where: { requestId: input.requestId },
        include: { product: { select: { name: true } } },
      });
      if (row) {
        const stock = (await computeForProducts([row.productCode])).get(row.productCode)!;
        return { ok: true, item: toItem(row), stock, deduped: true };
      }
    }
    throw e;
  }
}

/**
 * 정정: 원기록은 그대로 두고, 차이(새 수량 − 원 수량)를 정정 기록으로 추가한다.
 * 누가(createdBy)·언제(createdAt)·왜(correctionReason)·얼마(qtyBox=차이)가 남는다.
 */
export type CorrectResult =
  | { ok: true; correction: AdjustmentItem; original: AdjustmentItem; stock: AvailableStock }
  | { ok: false; message: string };

export async function correctAdjustmentAction(input: {
  id: number;
  newQtyBox: number;
  reason: string;
  requestId: string;
}): Promise<CorrectResult> {
  const denied = await requirePin();
  if (denied) return { ok: false, message: denied };
  const newQty = Number(input.newQtyBox);
  if (!Number.isInteger(newQty) || newQty < 0) return { ok: false, message: "정정 수량은 0 이상의 정수여야 합니다." };
  const why = input.reason?.trim();
  if (!why) return { ok: false, message: "정정 사유를 입력하세요." };
  if (!REQUEST_ID_RE.test(input.requestId ?? "")) return { ok: false, message: "요청 ID가 없습니다. 화면을 새로고침하세요." };

  const dupe = await prisma.stockAdjustment.findUnique({ where: { requestId: input.requestId }, include: { product: { select: { name: true } } } });
  const original = await prisma.stockAdjustment.findUnique({ where: { id: input.id }, include: { product: { select: { name: true } }, corrections: { where: { cancelledAt: null } } } });
  if (!original) return { ok: false, message: "원기록을 찾을 수 없습니다." };
  if (original.cancelledAt) return { ok: false, message: "취소된 기록은 정정할 수 없습니다. 새로 입력하세요." };
  if (original.correctsId) return { ok: false, message: "정정 기록은 다시 정정할 수 없습니다. 원기록을 정정하세요." };
  if (dupe) {
    const stock = (await computeForProducts([original.productCode])).get(original.productCode)!;
    return { ok: true, correction: toItem(dupe), original: toItem(original), stock };
  }

  // 현재 유효 수량 = 원 수량 + 기존 정정들의 합. 새 정정 = 목표 − 현재
  const current = original.qtyBox + original.corrections.reduce((s, c) => s + c.qtyBox, 0);
  const delta = newQty - current;
  if (delta === 0) return { ok: false, message: "현재 수량과 같습니다." };

  const row = await prisma.stockAdjustment.create({
    data: {
      productCode: original.productCode,
      qtyBox: delta,
      reason: original.reason,
      memo: `정정 → ${newQty.toLocaleString()} (원 #${original.id})`,
      createdBy: ACTOR,
      correctsId: original.id,
      correctionReason: why,
      requestId: input.requestId,
    },
    include: { product: { select: { name: true } } },
  });
  const stock = (await computeForProducts([original.productCode])).get(original.productCode)!;
  revalidate(original.productCode);
  return { ok: true, correction: toItem(row), original: toItem(original), stock };
}

export type CancelResult = { ok: true; item: AdjustmentItem; stock: AvailableStock } | { ok: false; message: string };

export async function cancelAdjustmentAction(id: number): Promise<CancelResult> {
  const denied = await requirePin();
  if (denied) return { ok: false, message: denied };
  const existing = await prisma.stockAdjustment.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
  if (!existing) return { ok: false, message: "해당 변동이 없습니다." };
  if (existing.cancelledAt) return { ok: false, message: "이미 취소된 변동입니다." };
  const now = new Date();
  const row = await prisma.stockAdjustment.update({
    where: { id },
    data: { cancelledAt: now },
    include: { product: { select: { name: true } } },
  });
  // 원기록을 취소하면 그 정정 기록도 함께 취소
  await prisma.stockAdjustment.updateMany({ where: { correctsId: id, cancelledAt: null }, data: { cancelledAt: now } });
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
