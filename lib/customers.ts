/**
 * 영업 조회: 거래처 검색 → 그 거래처의 최근 12개월 정상 출고 품목 → 품목 상세.
 * 기간 = 마지막 집계 완료 출고월(업로드에서 정한 집계 완료 월, lib/analytics/periods)을 끝으로 12개 달. 실제 시작·종료월을 돌려준다.
 * 수량은 판매실적 출고수량(낱개) 합. 현재 재고는 lib/stock computeForProducts (상세와 같은 계산).
 */
import { ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { cachedPeriodData } from "@/lib/analytics/cached";
import { shiftYm } from "@/lib/analytics/periods";
import { contextOf } from "@/lib/analytics/shipments";
import { prisma } from "@/lib/db";
import { computeForProducts } from "@/lib/stock";
import type { AvailableStock } from "@/lib/availableStock";

export const CUSTOMER_MONTHS = 12;

export type CustomerPeriod = { fromYm: string; toYm: string; basis: "complete" | "latest" } | null;

/** 끝 = 집계 완료 마지막 달. 집계 완료 월이 없으면 자료가 있는 마지막 달(화면에 그렇게 표시) */
export async function customerPeriod(): Promise<CustomerPeriod> {
  const ctx = contextOf(await cachedPeriodData());
  const end = ctx.completeThrough ?? ctx.lastYm;
  if (!end) return null;
  return { fromYm: shiftYm(end, -(CUSTOMER_MONTHS - 1)), toYm: end, basis: ctx.completeThrough ? "complete" : "latest" };
}

export type CustomerHit = { code: string; name: string; shipments: number };

/** 거래처명 부분일치 (공백으로 나눈 단어 모두 포함). 기간 안 정상 출고 건수 많은 순 */
export async function searchCustomers(q: string, period: CustomerPeriod): Promise<CustomerHit[]> {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const customers = await prisma.customer.findMany({
    where: { AND: words.map((w) => ({ name: { contains: w, mode: "insensitive" as const } })) },
    select: { code: true, name: true },
    take: 100,
  });
  if (customers.length === 0) return [];
  const counts = period
    ? await prisma.shipmentHistory.groupBy({
        by: ["customerCode"],
        where: { customerCode: { in: customers.map((c) => c.code) }, shipType: ANALYSIS_SHIP_TYPE, yearMonth: { gte: period.fromYm, lte: period.toYm } },
        _count: { _all: true },
      })
    : [];
  const byCode = new Map(counts.map((c) => [c.customerCode, c._count._all]));
  return customers
    .map((c) => ({ ...c, shipments: byCode.get(c.code) ?? 0 }))
    .sort((a, b) => b.shipments - a.shipments || a.name.localeCompare(b.name, "ko"))
    .slice(0, 30);
}

export type CustomerItem = {
  code: string;
  name: string;
  packUnit: string;
  unitsPerBox: number;
  shipments: number; // 기간 안 정상 출고 건수(전표 수)
  qtyUnits: number; // 기간 안 정상 출고수량 합(낱개)
  lastShipDate: string;
  stock: AvailableStock;
};

/** 거래처의 기간 안 정상 출고 품목. 확인된 품목(출고 건수 많은 순)이 위, 확인 필요 품목은 아래 */
export async function getCustomerItems(customerCode: string, period: NonNullable<CustomerPeriod>) {
  const customer = await prisma.customer.findUnique({ where: { code: customerCode }, select: { code: true, name: true } });
  if (!customer) return null;
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["productCode"],
    where: { customerCode, shipType: ANALYSIS_SHIP_TYPE, yearMonth: { gte: period.fromYm, lte: period.toYm } },
    _count: { _all: true },
    _sum: { qtyUnits: true },
    _max: { date: true },
  });
  const codes = rows.map((r) => r.productCode);
  const [products, stocks] = await Promise.all([
    prisma.product.findMany({ where: { code: { in: codes } }, select: { code: true, name: true, packUnit: true, unitsPerBox: true } }),
    computeForProducts(codes),
  ]);
  const pmap = new Map(products.map((p) => [p.code, p]));
  const items: CustomerItem[] = rows
    .filter((r) => pmap.has(r.productCode))
    .map((r) => {
      const p = pmap.get(r.productCode)!;
      return {
        code: p.code,
        name: p.name,
        packUnit: p.packUnit,
        unitsPerBox: p.unitsPerBox,
        shipments: r._count._all,
        qtyUnits: r._sum.qtyUnits ?? 0,
        lastShipDate: r._max.date ? r._max.date.toISOString().slice(0, 10) : "",
        stock: stocks.get(p.code)!,
      };
    })
    .sort((a, b) => b.shipments - a.shipments || b.lastShipDate.localeCompare(a.lastShipDate) || a.code.localeCompare(b.code));
  return {
    customer,
    checked: items.filter((i) => i.stock.available !== null),
    unchecked: items.filter((i) => i.stock.available === null),
  };
}
