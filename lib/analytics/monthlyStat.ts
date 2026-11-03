/**
 * MonthlyStat 재계산. 실적(판매·생산) 업로드 뒤 호출.
 * 61k + 85k 행을 메모리에서 집계하므로 DB 종류에 의존하지 않는다 (SQLite → PostgreSQL 교체 가능).
 */
import { ANALYSIS_SALES_TYPE, ANALYSIS_SHIP_TYPE, PRODUCTION_SLIP_TYPES } from "@/config/excel-mapping";
import type { PrismaClient } from "@/lib/generated/prisma/client";

type Stat = {
  qtyProduced: number;
  qtyProducedBox: number;
  qtyProdDefect: number;
  qtyShippedBox: number;
  qtyShippedB2B: number;
  qtyShippedB2C: number;
  qtyNormalBox: number;
  qtyNormalB2B: number;
  qtyNormalB2C: number;
  qtyReturnBox: number;
};

export async function rebuildMonthlyStat(db: PrismaClient): Promise<number> {
  const stats = new Map<string, Stat>();
  const get = (productCode: string, yearMonth: string) => {
    const k = `${productCode}\u0000${yearMonth}`;
    let s = stats.get(k);
    if (!s) {
      s = { qtyProduced: 0, qtyProducedBox: 0, qtyProdDefect: 0, qtyShippedBox: 0, qtyShippedB2B: 0, qtyShippedB2C: 0, qtyNormalBox: 0, qtyNormalB2B: 0, qtyNormalB2C: 0, qtyReturnBox: 0 };
      stats.set(k, s);
    }
    return s;
  };

  const prod = await db.productionHistory.findMany({
    where: { slipType: { in: [...PRODUCTION_SLIP_TYPES] } },
    select: { productCode: true, yearMonth: true, qtyGood: true, qtyDefect: true, unitsPerBox: true },
  });
  const upbOf = new Map(
    (await db.product.findMany({ select: { code: true, unitsPerBox: true } })).map((p) => [p.code, p.unitsPerBox]),
  );
  for (const p of prod) {
    const s = get(p.productCode, p.yearMonth);
    s.qtyProduced += p.qtyGood;
    const upb = p.unitsPerBox ?? upbOf.get(p.productCode) ?? 1;
    s.qtyProducedBox += upb > 0 ? p.qtyGood / upb : p.qtyGood;
    s.qtyProdDefect += p.qtyDefect;
  }

  const customers = await db.customer.findMany({ select: { code: true, type: true } });
  const typeOf = new Map(customers.map((c) => [c.code, c.type]));
  // 정상·내수 (재고 관리 기준)과 정상·반품 (분석 기준)을 한 번에
  const ship = await db.shipmentHistory.findMany({
    where: { shipType: { in: [ANALYSIS_SHIP_TYPE, "반품"] } },
    select: { productCode: true, yearMonth: true, qtyBox: true, customerCode: true, shipType: true, salesType: true },
  });
  for (const r of ship) {
    const s = get(r.productCode, r.yearMonth);
    const b2b = typeOf.get(r.customerCode) === "B2B";
    if (r.shipType === "반품") {
      s.qtyReturnBox += Math.abs(r.qtyBox);
      continue;
    }
    s.qtyNormalBox += r.qtyBox;
    if (b2b) s.qtyNormalB2B += r.qtyBox;
    else s.qtyNormalB2C += r.qtyBox;
    if (r.salesType === ANALYSIS_SALES_TYPE) {
      s.qtyShippedBox += r.qtyBox;
      if (b2b) s.qtyShippedB2B += r.qtyBox;
      else s.qtyShippedB2C += r.qtyBox;
    }
  }

  const data = [...stats.entries()].map(([k, s]) => {
    const [productCode, yearMonth] = k.split("\u0000");
    return { productCode, yearMonth, ...s };
  });
  await db.monthlyStat.deleteMany({});
  for (let i = 0; i < data.length; i += 500) await db.monthlyStat.createMany({ data: data.slice(i, i + 500) });
  return data.length;
}
