/**
 * 월별 출고량 (낱개) — 출고실적 원본에서 바로 집계. 분석 탭 "월별 출고량" 차트·비교 수치용.
 *
 * - 수량 = ShipmentHistory.qtyUnits = 원본 "출고수량" 열(낱개, 업로드 시 반올림만). 박스 환산 없이 그대로 합산.
 * - 정상: 출고구분 "정상", 판매형태·거래처·생산 기록 유무와 무관하게 전부. 부호 그대로 합(정상 음수 정정 행 포함).
 * - 반품: 출고구분 "반품", 원본이 음수로 들어오므로 부호를 뒤집어 양수 합.
 * - 완전성: 출고 행이 하나라도 있는 달 집합 + SALES_COMPLETE_THROUGH (config/analytics.ts).
 */
import { SALES_COMPLETE_THROUGH } from "@/config/analytics";
import { prisma } from "@/lib/db";
import { buildContext, type PeriodContext } from "./periods";

export async function getPeriodContext(): Promise<PeriodContext> {
  const rows = await prisma.shipmentHistory.groupBy({ by: ["yearMonth"], _count: { _all: true } });
  return buildContext(
    rows.filter((r) => r._count._all > 0).map((r) => r.yearMonth),
    SALES_COMPLETE_THROUGH,
  );
}

export type MonthlyUnits = {
  normal: Map<string, number>;
  returns: Map<string, number>;
  normalRows: Map<string, number>;
};

/** 월별 정상·반품 출고수량(낱개). code가 없으면 전체 거래처·전 품목 */
export async function getMonthlyUnits(code?: string): Promise<MonthlyUnits> {
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["yearMonth", "shipType"],
    where: { shipType: { in: ["정상", "반품"] }, ...(code ? { productCode: code } : {}) },
    _sum: { qtyUnits: true },
    _count: { _all: true },
  });
  const normal = new Map<string, number>();
  const returns = new Map<string, number>();
  const normalRows = new Map<string, number>();
  for (const r of rows) {
    const q = r._sum.qtyUnits ?? 0;
    if (r.shipType === "정상") {
      normal.set(r.yearMonth, q);
      normalRows.set(r.yearMonth, r._count._all);
    } else returns.set(r.yearMonth, -q);
  }
  return { normal, returns, normalRows };
}
