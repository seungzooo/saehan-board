/**
 * 가용재고 산식 (CLAUDE.md "가용재고 산식")
 *
 *   가용재고 = 기초재고(최근 재고 파일)
 *            − Σ 불량 차감  (불량 리셋 시점 이후. 리셋 시점 = 가장 최근 "사후 불량 반영됨" 재고 파일의 반영 시각)
 *            − Σ 출고 차감  (최근 파일 반영 이후)
 *            − Σ 수주       (최근 파일 반영 이후)
 *            − Σ 기타       (최근 파일 반영 이후)
 *
 * - 취소된 변동(cancelledAt != null)은 모두 무시한다.
 * - 최근 재고 파일에 없는 품목은 available = null ("확인 필요"). 음수로 계산하지 않는다.
 *   파일에 0으로 있는 품목은 available = 0 ("0박스") — 둘을 구분한다.
 * - 이 파일은 DB에 의존하지 않는다. 테스트: tests/availableStock.test.ts
 */

import { isSameSeoulDay } from "@/lib/format";

export type AdjustmentReason = "DEFECT" | "SHIPMENT" | "ORDER" | "OTHER";
export const ADJUSTMENT_REASONS: AdjustmentReason[] = ["DEFECT", "SHIPMENT", "ORDER", "OTHER"];
export const REASON_LABEL: Record<AdjustmentReason, string> = {
  DEFECT: "불량",
  SHIPMENT: "출고",
  ORDER: "수주",
  OTHER: "기타",
};

export type SnapshotLike = {
  qtyBox: number;
  uploadedAt: Date; // 앱 반영 시각 — 출고·수주·기타 차감의 기준점
  stockAsOf?: Date | null; // 파일의 집계 기준 시각 (표시용)
  defectResetAt?: Date | null; // 이 시각 이전 불량 차감은 무시 (null이면 전부 누적)
} | null;

export type AdjustmentLike = {
  qtyBox: number;
  reason: AdjustmentReason | string;
  createdAt: Date;
  cancelledAt: Date | null;
};

export type AvailableStock = {
  /** null = 확인 필요 (최근 재고 파일에 품목이 없음) */
  available: number | null;
  baseline: number | null;
  hasBaseline: boolean;
  uploadedAt: Date | null;
  stockAsOf: Date | null;
  deductions: Record<AdjustmentReason, number>;
  todayDeduction: number; // 오늘(Asia/Seoul 날짜) 미취소 변동 합 — 화면 표시용
};

export type ComputeOptions = { now?: Date };

export function computeAvailableStock(
  snapshot: SnapshotLike,
  adjustments: AdjustmentLike[],
  opts: ComputeOptions = {},
): AvailableStock {
  const now = opts.now ?? new Date();
  const since = snapshot?.uploadedAt ?? null;
  const defectResetAt = snapshot?.defectResetAt ?? null;

  const deductions: Record<AdjustmentReason, number> = { DEFECT: 0, SHIPMENT: 0, ORDER: 0, OTHER: 0 };
  let todayDeduction = 0;

  for (const a of adjustments) {
    if (a.cancelledAt) continue;
    const reason = (ADJUSTMENT_REASONS as string[]).includes(a.reason) ? (a.reason as AdjustmentReason) : "OTHER";
    if (isSameSeoulDay(a.createdAt, now)) todayDeduction += a.qtyBox;

    const counts =
      reason === "DEFECT"
        ? defectResetAt === null || a.createdAt > defectResetAt
        : since === null || a.createdAt > since;
    if (counts) deductions[reason] += a.qtyBox;
  }

  if (!snapshot) {
    return {
      available: null,
      baseline: null,
      hasBaseline: false,
      uploadedAt: null,
      stockAsOf: null,
      deductions,
      todayDeduction,
    };
  }
  const total = deductions.DEFECT + deductions.SHIPMENT + deductions.ORDER + deductions.OTHER;
  return {
    available: snapshot.qtyBox - total,
    baseline: snapshot.qtyBox,
    hasBaseline: true,
    uploadedAt: snapshot.uploadedAt,
    stockAsOf: snapshot.stockAsOf ?? null,
    deductions,
    todayDeduction,
  };
}
