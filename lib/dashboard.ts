/** 홈 대시보드 지표. 전부 조회 시점 계산 — 저장하지 않는다. 품목 집계는 lib/activity.ts getHomeSummary */
import { prisma } from "@/lib/db";
import { seoulParts } from "@/lib/format";

/** 오늘(Asia/Seoul) 00:00 의 UTC 시각 */
export function seoulDayStart(now = new Date()): Date {
  const { y, m, d } = seoulParts(now);
  return new Date(`${y}-${m}-${d}T00:00:00+09:00`);
}

/** 오늘 등록된 변동 건수와 마지막 반영 시각 */
export async function getTodayActivity() {
  const [todayAdjustments, last] = await Promise.all([
    prisma.stockAdjustment.count({ where: { createdAt: { gte: seoulDayStart() }, cancelledAt: null } }),
    prisma.stockAdjustment.findFirst({ where: { cancelledAt: null }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { todayAdjustments, lastAdjustmentAt: last?.createdAt ?? null };
}
