/**
 * 월별 출고량 (낱개) — 출고실적 원본에서 바로 집계. 분석 탭 "월별 출고량" 차트·비교 수치용.
 *
 * - 수량 = ShipmentHistory.qtyUnits = 원본 "출고수량" 열(낱개, 업로드 시 반올림만). 박스 환산 없이 그대로 합산.
 * - 정상: 출고구분 "정상", 판매형태·거래처·생산 기록 유무와 무관하게 전부. 부호 그대로 합(정상 음수 정정 행 포함).
 * - 반품: 출고구분 "반품", 원본이 음수로 들어오므로 부호를 뒤집어 양수 합.
 * - 완전성: 출고 행이 하나라도 있는 달 집합 + 가장 최근 출고실적 업로드 배치의 "집계 완료 월".
 */
import { prisma } from "@/lib/db";
import { effectiveCompletion, type CompletionBatch } from "./completion";
import { buildContext, type PeriodContext } from "./periods";

/** 집계 완료 월과 그 값을 정한 업로드 (출고·생산) */
export type CompletionInfo = {
  sales: CompletionBatch | null;
  production: CompletionBatch | null;
};

export async function getCompletionInfo(): Promise<CompletionInfo> {
  const batches = await prisma.uploadBatch.findMany({
    where: { kind: { in: ["SALES", "PRODUCTION"] } },
    select: { id: true, kind: true, fileName: true, uploadedAt: true, completeThrough: true, revertedAt: true },
  });
  const plain = (b: CompletionBatch | null) =>
    b ? { ...b, uploadedAt: new Date(b.uploadedAt).toISOString(), revertedAt: b.revertedAt ? new Date(b.revertedAt).toISOString() : null } : null;
  return { sales: plain(effectiveCompletion(batches, "SALES")), production: plain(effectiveCompletion(batches, "PRODUCTION")) };
}

/** 직렬화 가능한 기간 정보 (캐시·클라이언트 전달용). buildContext로 되살린다 */
export type PeriodData = { presentMonths: string[]; declaredThrough: string | null };

export async function getPeriodData(): Promise<PeriodData> {
  const [rows, info] = await Promise.all([
    prisma.shipmentHistory.groupBy({ by: ["yearMonth"], _count: { _all: true } }),
    getCompletionInfo(),
  ]);
  return {
    presentMonths: rows.filter((r) => r._count._all > 0).map((r) => r.yearMonth).sort(),
    declaredThrough: info.sales?.completeThrough ?? null,
  };
}

export function contextOf(d: PeriodData): PeriodContext {
  return buildContext(d.presentMonths, d.declaredThrough);
}

export async function getPeriodContext(): Promise<PeriodContext> {
  return contextOf(await getPeriodData());
}

/** 직렬화 가능한 월별 수량: [연월, 낱개][] */
export type MonthlyUnitsData = { normal: [string, number][]; returns: [string, number][] };

export type MonthlyUnits = {
  normal: Map<string, number>;
  returns: Map<string, number>;
};

export function unitsOf(d: MonthlyUnitsData): MonthlyUnits {
  return { normal: new Map(d.normal), returns: new Map(d.returns) };
}

/** 월별 정상·반품 출고수량(낱개). code가 없으면 전체 거래처·전 품목 */
export async function getMonthlyUnitsData(code?: string): Promise<MonthlyUnitsData> {
  const rows = await prisma.shipmentHistory.groupBy({
    by: ["yearMonth", "shipType"],
    where: { shipType: { in: ["정상", "반품"] }, ...(code ? { productCode: code } : {}) },
    _sum: { qtyUnits: true },
  });
  const normal: [string, number][] = [];
  const returns: [string, number][] = [];
  for (const r of rows) {
    const q = r._sum.qtyUnits ?? 0;
    if (r.shipType === "정상") normal.push([r.yearMonth, q]);
    else returns.push([r.yearMonth, -q]);
  }
  return { normal: normal.sort(), returns: returns.sort() };
}

export async function getMonthlyUnits(code?: string): Promise<MonthlyUnits> {
  return unitsOf(await getMonthlyUnitsData(code));
}
