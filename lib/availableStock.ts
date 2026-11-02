/**
 * 가용재고 산식 (CLAUDE.md "가용재고 산식")
 *
 *   가용재고 = 기초재고(최근 업로드)
 *            − Σ 불량 차감  (기본: 전체 누적. DEFECT_RESET_ON_UPLOAD=true면 업로드 이후만)
 *            − Σ 출고 차감  (업로드 이후)
 *            − Σ 수주       (업로드 이후)
 *            − Σ 기타       (업로드 이후)
 *
 * 취소된 변동(cancelledAt != null)은 모두 무시한다.
 * 이 파일은 DB에 의존하지 않는다 — 순수 계산. 테스트: tests/availableStock.test.ts
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

export type SnapshotLike = { qtyBox: number; uploadedAt: Date } | null;
export type AdjustmentLike = {
  qtyBox: number;
  reason: AdjustmentReason | string;
  createdAt: Date;
  cancelledAt: Date | null;
};

export type AvailableStock = {
  available: number;
  baseline: number;
  hasBaseline: boolean;
  uploadedAt: Date | null;
  deductions: Record<AdjustmentReason, number>;
  todayDeduction: number; // 오늘(Asia/Seoul 날짜) 미취소 변동 합 — 화면 표시용
};

export type ComputeOptions = {
  defectResetOnUpload?: boolean;
  now?: Date;
};

export function defectResetFromEnv(): boolean {
  return (process.env.DEFECT_RESET_ON_UPLOAD ?? "false").toLowerCase() === "true";
}


export function computeAvailableStock(
  snapshot: SnapshotLike,
  adjustments: AdjustmentLike[],
  opts: ComputeOptions = {},
): AvailableStock {
  const defectReset = opts.defectResetOnUpload ?? false;
  const now = opts.now ?? new Date();
  const baseline = snapshot?.qtyBox ?? 0;
  const since = snapshot?.uploadedAt ?? null;

  const deductions: Record<AdjustmentReason, number> = { DEFECT: 0, SHIPMENT: 0, ORDER: 0, OTHER: 0 };
  let todayDeduction = 0;

  for (const a of adjustments) {
    if (a.cancelledAt) continue;
    const reason = (ADJUSTMENT_REASONS as string[]).includes(a.reason) ? (a.reason as AdjustmentReason) : "OTHER";
    if (isSameSeoulDay(a.createdAt, now)) todayDeduction += a.qtyBox;

    const afterUpload = since === null || a.createdAt > since;
    const counts = reason === "DEFECT" && !defectReset ? true : afterUpload;
    if (counts) deductions[reason] += a.qtyBox;
  }

  const total = deductions.DEFECT + deductions.SHIPMENT + deductions.ORDER + deductions.OTHER;
  return {
    available: baseline - total,
    baseline,
    hasBaseline: snapshot !== null,
    uploadedAt: since,
    deductions,
    todayDeduction,
  };
}
