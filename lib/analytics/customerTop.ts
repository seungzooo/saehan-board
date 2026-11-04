/**
 * 거래선 TOP 10 (정상 출고, 낱개) + 거래선의 주력 제품 월별 타임라인.
 * 기간 = 최근 12개월(집계 완료 마지막 달 기준) 또는 연도(그해 집계 완료된 달). 전년 대비 = 같은 달들의 전년 합(그 달들이 모두 완료일 때만).
 * B2B/B2C 구분은 쓰지 않는다(회사 분류표 전).
 */
import { ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import { prisma } from "@/lib/db";
import { monthStatus, shiftYm, type PeriodContext } from "./periods";

export type TopPeriod = { key: string; label: string; from: string; to: string; months: number };

export function topPeriods(ctx: PeriodContext): TopPeriod[] {
  const out: TopPeriod[] = [];
  const end = ctx.completeThrough;
  if (!end || !ctx.firstYm) return out;
  const from12 = shiftYm(end, -11) < ctx.firstYm ? ctx.firstYm : shiftYm(end, -11);
  out.push({ key: "recent", label: "최근 12개월", from: from12, to: end, months: monthsBetween(from12, end) });
  const years = [...new Set([...ctx.present].map((m) => m.slice(0, 4)))].sort().reverse();
  for (const y of years) {
    const ok = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`).filter((m) => monthStatus(m, ctx) === "ok");
    if (ok.length === 0) continue;
    out.push({ key: y, label: `${y}년${ok.length < 12 ? ` (${Number(ok[0].slice(5))}~${Number(ok.at(-1)!.slice(5))}월)` : ""}`, from: ok[0], to: ok.at(-1)!, months: ok.length });
  }
  return out;
}

function monthsBetween(a: string, b: string) {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + mb - ma + 1;
}

export type TopRow = { rank: number; customer: string; units: number; share: number; prev: number | null; yoy: number | null };

export async function getCustomerTop(p: TopPeriod, ctx: PeriodContext, limit = 10): Promise<{ total: number; prevComparable: boolean; rows: TopRow[] }> {
  const prevFrom = shiftYm(p.from, -12);
  const prevTo = shiftYm(p.to, -12);
  let prevComparable = true;
  for (let m = prevFrom; m <= prevTo; m = shiftYm(m, 1)) if (monthStatus(m, ctx) !== "ok") prevComparable = false;
  const [cur, prev] = await Promise.all([
    prisma.shipmentHistory.groupBy({ by: ["customerCode"], where: { shipType: ANALYSIS_SHIP_TYPE, yearMonth: { gte: p.from, lte: p.to } }, _sum: { qtyUnits: true } }),
    prevComparable
      ? prisma.shipmentHistory.groupBy({ by: ["customerCode"], where: { shipType: ANALYSIS_SHIP_TYPE, yearMonth: { gte: prevFrom, lte: prevTo } }, _sum: { qtyUnits: true } })
      : Promise.resolve([]),
  ]);
  const total = cur.reduce((s, r) => s + (r._sum.qtyUnits ?? 0), 0);
  const prevOf = new Map(prev.map((r) => [r.customerCode, r._sum.qtyUnits ?? 0]));
  const rows = cur
    .map((r) => ({ customer: r.customerCode, units: r._sum.qtyUnits ?? 0 }))
    .sort((a, b) => b.units - a.units)
    .slice(0, limit)
    .map((r, i) => {
      const pv = prevComparable ? (prevOf.get(r.customer) ?? 0) : null;
      return { rank: i + 1, ...r, share: total > 0 ? r.units / total : 0, prev: pv, yoy: pv && pv > 0 ? (r.units / pv - 1) * 100 : null };
    });
  return { total, prevComparable, rows };
}

export type Timeline = { months: string[]; products: { code: string; name: string; units: number }[]; total: number[]; series: Record<string, number[]> };

/** 거래선의 주력 제품(기간 출고 상위 5) 월별 출고 — 집계 완료된 달 전체 */
export async function getCustomerTimeline(customer: string, p: TopPeriod, ctx: PeriodContext): Promise<Timeline> {
  const months: string[] = [];
  if (ctx.firstYm && ctx.completeThrough) for (let m = ctx.firstYm; m <= ctx.completeThrough; m = shiftYm(m, 1)) if (monthStatus(m, ctx) === "ok") months.push(m);
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["productCode", "yearMonth"],
    where: { customerCode: customer, shipType: ANALYSIS_SHIP_TYPE, yearMonth: { gte: months[0] ?? "0000", lte: months.at(-1) ?? "9999" } },
    _sum: { qtyUnits: true },
  });
  const inPeriod = new Map<string, number>();
  for (const r of rows) if (r.yearMonth >= p.from && r.yearMonth <= p.to) inPeriod.set(r.productCode, (inPeriod.get(r.productCode) ?? 0) + (r._sum.qtyUnits ?? 0));
  const top = [...inPeriod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const names = new Map((await prisma.product.findMany({ where: { code: { in: top.map(([c]) => c) } }, select: { code: true, name: true } })).map((x) => [x.code, x.name]));
  const idx = new Map(months.map((m, i) => [m, i]));
  const series: Record<string, number[]> = Object.fromEntries(top.map(([c]) => [c, months.map(() => 0)]));
  const total = months.map(() => 0);
  for (const r of rows) {
    const i = idx.get(r.yearMonth);
    if (i === undefined) continue;
    const v = r._sum.qtyUnits ?? 0;
    total[i] += v;
    if (series[r.productCode]) series[r.productCode][i] += v;
  }
  return { months, products: top.map(([code, units]) => ({ code, name: names.get(code) ?? code, units })), total, series };
}
