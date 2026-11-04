/**
 * 저장된 변동 탐지 결과 읽기 (화면 전용). 표가 아직 없으면(마이그레이션 전) available=false로 돌려 화면이 깨지지 않게 한다.
 */
import { prisma } from "@/lib/db";
import type { EventDetail } from "./describe";
import { KIND_LABEL } from "./describe";
import type { Contributor, EventKind } from "./detect";

export type EventView = {
  id: string;
  groupKey: string;
  isLead: boolean;
  kind: EventKind;
  kindLabel: string;
  scope: string;
  customer: string | null;
  product: string | null;
  grain: string;
  periodStart: string;
  periodEnd: string;
  diff: number;
  impact: number;
  title: string;
  baselineDesc: string;
  contributors: Contributor[];
  detail: EventDetail;
  notes: { id: number; text: string; createdAt: string }[];
};
export type EventGroupView = { lead: EventView; related: EventView[] };
export type RunInfo = { ranAt: string; completeThrough: string | null; firstMonth: string | null; events: number; groups: number; materiality: number; missingMonths: string[] } | null;

type Row = Awaited<ReturnType<typeof prisma.shipmentEvent.findMany>>[number];
function view(r: Row, notes: Map<string, EventView["notes"]>): EventView {
  const d = r.data as { baselineDesc: string; contributors: Contributor[]; detail: EventDetail };
  return {
    id: r.id,
    groupKey: r.groupKey,
    isLead: r.isLead,
    kind: r.kind as EventKind,
    kindLabel: KIND_LABEL[r.kind as EventKind] ?? r.kind,
    scope: r.scope,
    customer: r.customerCode,
    product: r.productCode,
    grain: r.grain,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    diff: r.diff,
    impact: r.impact,
    title: r.title,
    baselineDesc: d.baselineDesc,
    contributors: d.contributors ?? [],
    detail: d.detail,
    notes: notes.get(r.id) ?? [],
  };
}

async function withNotes(rows: Row[]) {
  const ids = rows.map((r) => r.id);
  const notes = ids.length ? await prisma.shipmentEventNote.findMany({ where: { eventId: { in: ids } }, orderBy: { createdAt: "asc" } }) : [];
  const m = new Map<string, EventView["notes"]>();
  for (const n of notes) m.set(n.eventId, [...(m.get(n.eventId) ?? []), { id: n.id, text: n.text, createdAt: n.createdAt.toISOString() }]);
  return rows.map((r) => view(r, m));
}

async function groupsOf(leads: Row[]): Promise<EventGroupView[]> {
  if (leads.length === 0) return [];
  const members = await prisma.shipmentEvent.findMany({ where: { groupKey: { in: leads.map((l) => l.groupKey) }, isLead: false }, orderBy: { impact: "desc" } });
  const all = await withNotes([...leads, ...members]);
  const byId = new Map(all.map((v) => [v.id, v]));
  return leads.map((l) => ({ lead: byId.get(l.id)!, related: all.filter((v) => v.groupKey === l.groupKey && !v.isLead) }));
}

export async function getRunInfo(): Promise<RunInfo> {
  try {
    const r = await prisma.shipmentEventRun.findFirst({ orderBy: { ranAt: "desc" } });
    if (!r) return null;
    return { ranAt: r.ranAt.toISOString(), completeThrough: r.completeThrough, firstMonth: r.firstMonth, events: r.events, groups: r.groups, materiality: r.materiality, missingMonths: r.missingMonths ? r.missingMonths.split(",") : [] };
  } catch {
    return null; // 표 없음(마이그레이션 전)
  }
}

const shiftYm = (ym: string, d: number) => {
  const [y, m] = ym.split("-").map(Number);
  const i = y * 12 + m - 1 + d;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/** 이번 기간(집계 완료 마지막 달 포함 최근 12개월)에 시작된 변화 중 영향 큰 순 — 해마다 반복되는 패턴은 제외 */
export async function getRecentGroups(limit = 3): Promise<{ run: RunInfo; from: string | null; to: string | null; groups: EventGroupView[] }> {
  const run = await getRunInfo();
  if (!run?.completeThrough) return { run, from: null, to: null, groups: [] };
  const from = shiftYm(run.completeThrough, -11);
  const leads = await prisma.shipmentEvent.findMany({
    where: {
      isLead: true,
      kind: { notIn: ["SEASON_UP", "SEASON_DOWN"] },
      OR: [{ periodStart: { gte: from } }, { kind: { in: ["TREND_UP", "TREND_DOWN"] }, periodEnd: { gte: from } }],
    },
    orderBy: { groupImpact: "desc" },
    take: limit,
  });
  return { run, from, to: run.completeThrough, groups: await groupsOf(leads) };
}

export type EventFilter = { from?: string; to?: string; customer?: string; product?: string; kind?: string; page?: number };
export const EVENTS_PAGE = 30;

/** 전체 보기: 기간·거래처·품목·유형으로 찾기 (대표만, 영향 큰 순) */
export async function searchGroups(f: EventFilter): Promise<{ total: number; groups: EventGroupView[] }> {
  const where: Record<string, unknown> = { isLead: true };
  const and: Record<string, unknown>[] = [];
  if (f.from) and.push({ periodEnd: { gte: f.from } });
  if (f.to) and.push({ periodStart: { lte: f.to.length === 7 ? `${f.to}-31` : f.to } });
  if (f.customer) and.push({ customerCode: { contains: f.customer, mode: "insensitive" } });
  if (f.product) {
    const ps = await prisma.product.findMany({ where: { OR: [{ code: { contains: f.product, mode: "insensitive" } }, { name: { contains: f.product, mode: "insensitive" } }] }, select: { code: true }, take: 200 });
    and.push({ productCode: { in: ps.map((p) => p.code) } });
  }
  if (f.kind) and.push({ kind: { in: f.kind.split(",") } });
  if (and.length) where.AND = and;
  const [total, leads] = await Promise.all([
    prisma.shipmentEvent.count({ where }),
    prisma.shipmentEvent.findMany({ where, orderBy: { groupImpact: "desc" }, skip: ((f.page ?? 1) - 1) * EVENTS_PAGE, take: EVENTS_PAGE }),
  ]);
  return { total, groups: await groupsOf(leads) };
}

/** 거래선 하나의 탐지 결과 (거래처 단위·거래처×품목) — 타임라인 점 */
export async function getCustomerEvents(customer: string): Promise<EventView[]> {
  try {
    const rows = await prisma.shipmentEvent.findMany({
      where: { customerCode: customer, scope: { in: ["CUSTOMER", "PAIR"] }, grain: "MONTH" },
      orderBy: { periodStart: "asc" },
    });
    return withNotes(rows);
  } catch {
    return [];
  }
}
