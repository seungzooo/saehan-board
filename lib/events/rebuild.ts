/**
 * 출고 변동 탐지 다시 계산·저장. 실적 업로드·업로드 취소·집계 완료 월 수정 때 호출(app/upload/actions.ts),
 * 처음 한 번은 scripts/rebuild-events.ts. 화면은 저장된 결과(ShipmentEvent)만 읽는다.
 */
import { ANALYSIS_SHIP_TYPE } from "@/config/excel-mapping";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { contextOf, getPeriodData } from "@/lib/analytics/shipments";
import { monthStatus } from "@/lib/analytics/periods";
import { isMonthEnd } from "@/lib/analytics/itemStats";
import { detectEvents, groupEvents, type DailyRow, type DetectedEvent } from "./detect";
import { detailOf, titleOf } from "./describe";

export async function rebuildShipmentEvents(db: PrismaClient): Promise<{ events: number; groups: number; ms: number }> {
  const t0 = Date.now();
  const [period, ships, products] = await Promise.all([
    getPeriodData(),
    db.shipmentHistory.groupBy({ by: ["date", "customerCode", "productCode"], where: { shipType: ANALYSIS_SHIP_TYPE }, _sum: { qtyUnits: true } }),
    db.product.findMany({ select: { code: true, name: true } }),
  ]);
  const ctx = contextOf(period);
  const completeMonths = [...ctx.present].filter((m) => monthStatus(m, ctx) === "ok");
  // 자료 범위 안 빈 달(누락)도 완료 달 목록에 넣어야 detectEvents가 '자료 누락'으로 구분한다
  if (ctx.firstYm && ctx.completeThrough) {
    for (let ym = ctx.firstYm; ym <= ctx.completeThrough; ) {
      if (!completeMonths.includes(ym) && monthStatus(ym, ctx) === "missing") completeMonths.push(ym);
      const [y, m] = ym.split("-").map(Number);
      ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    }
  }
  completeMonths.sort();
  const rows: DailyRow[] = ships.map((s) => ({ date: s.date.toISOString().slice(0, 10), customer: s.customerCode, product: s.productCode, units: s._sum.qtyUnits ?? 0 }));

  // 월말 일괄 기록 품목: 정상 출고 2건 이상이 전부 그달 마지막 날
  const me = new Map<string, { n: number; m: number }>();
  for (const r of rows) {
    const c = me.get(r.product) ?? { n: 0, m: 0 };
    c.n++;
    if (isMonthEnd(r.date)) c.m++;
    me.set(r.product, c);
  }
  const monthEndProducts = new Set([...me.entries()].filter(([, c]) => c.n >= 2 && c.m === c.n).map(([k]) => k));

  const { events, missingMonths, materiality } = detectEvents({ rows, completeMonths, monthEndProducts });
  const groups = groupEvents(events);
  const nameOf = new Map(products.map((p) => [p.code, p.name]));
  const names = { product: (c: string) => nameOf.get(c) ?? c };

  const data = groups.flatMap((g) => {
    const groupImpact = Math.max(...g.members.map((m) => m.impact));
    return g.members.map((e) => ({
      id: e.id,
      groupKey: g.key,
      isLead: e.id === g.lead.id,
      kind: e.kind,
      scope: e.scope,
      customerCode: e.customer,
      productCode: e.product,
      grain: e.grain,
      periodStart: e.periodStart,
      periodEnd: e.grain === "WEEK" ? e.periodEnd.slice(0, 7) : e.periodEnd,
      actual: e.actual,
      baseline: e.baseline,
      diff: e.diff,
      impact: e.impact,
      groupImpact,
      title: titleOf(e, names),
      data: {
        baselineDesc: e.baselineDesc,
        baselinePeriods: e.baselinePeriods,
        spread: e.spread,
        contributors: e.contributors,
        extra: e.extra,
        weekEnd: e.grain === "WEEK" ? e.periodEnd : null,
        detail: detailOf(e, names, { monthEndProducts, relatedStops: relatedStopsOf(e, events) }),
      } as object,
    }));
  });

  await db.$transaction(
    async (tx) => {
      await tx.shipmentEvent.deleteMany({});
      for (let i = 0; i < data.length; i += 500) await tx.shipmentEvent.createMany({ data: data.slice(i, i + 500) });
      await tx.shipmentEventRun.create({
        data: { completeThrough: ctx.completeThrough, firstMonth: ctx.firstYm, events: data.length, groups: groups.length, materiality, missingMonths: missingMonths.join(",") },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { events: data.length, groups: groups.length, ms: Date.now() - t0 };
}

/** 늘어난 거래처×품목 변화와 시기가 가까운(앞 12개월~뒤 3개월) 같은 거래처의 다른 품목 끊김 — 품번 전환 확인용 (원인 단정 아님) */
export function relatedStopsOf(e: DetectedEvent, all: DetectedEvent[]): DetectedEvent[] {
  if (e.scope !== "PAIR" || e.diff <= 0) return [];
  const lo = shiftYm(e.periodStart, -12);
  const hi = shiftYm(e.periodStart, 3);
  return all.filter((s) => s.kind === "STOP" && s.scope === "PAIR" && s.customer === e.customer && s.product !== e.product && s.periodStart >= lo && s.periodStart <= hi).slice(0, 2);
}
function shiftYm(ym: string, d: number) {
  const [y, m] = ym.split("-").map(Number);
  const i = y * 12 + m - 1 + d;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
