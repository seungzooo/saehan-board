import { describe, expect, it } from "vitest";
import { computeAvailableStock, type AdjustmentLike } from "@/lib/availableStock";

const T = (s: string) => new Date(s);
const adj = (
  qtyBox: number,
  reason: AdjustmentLike["reason"],
  createdAt: string,
  cancelledAt: string | null = null,
): AdjustmentLike => ({ qtyBox, reason, createdAt: T(createdAt), cancelledAt: cancelledAt ? T(cancelledAt) : null });

describe("computeAvailableStock", () => {
  it("기초재고만 있으면 그대로", () => {
    const r = computeAvailableStock({ qtyBox: 100, uploadedAt: T("2026-01-10T09:00") }, []);
    expect(r.available).toBe(100);
    expect(r.baseline).toBe(100);
    expect(r.deductions).toEqual({ DEFECT: 0, SHIPMENT: 0, ORDER: 0, OTHER: 0 });
  });

  it("업로드 이후 출고·불량·기타·수주를 차감한다", () => {
    const r = computeAvailableStock({ qtyBox: 100, uploadedAt: T("2026-01-10T09:00") }, [
      adj(10, "SHIPMENT", "2026-01-10T10:00"),
      adj(3, "DEFECT", "2026-01-10T11:00"),
      adj(2, "OTHER", "2026-01-10T12:00"),
      adj(5, "ORDER", "2026-01-10T13:00"),
    ]);
    expect(r.available).toBe(80);
    expect(r.deductions).toEqual({ DEFECT: 3, SHIPMENT: 10, ORDER: 5, OTHER: 2 });
  });

  it("취소된 변동은 무시한다", () => {
    const r = computeAvailableStock({ qtyBox: 100, uploadedAt: T("2026-01-10T09:00") }, [
      adj(10, "SHIPMENT", "2026-01-10T10:00", "2026-01-10T10:30"),
    ]);
    expect(r.available).toBe(100);
  });

  it("재업로드하면 출고 차감은 리셋된다 (업로드 이전 변동은 ERP가 이미 반영)", () => {
    const adjustments = [adj(30, "SHIPMENT", "2026-01-10T10:00"), adj(5, "SHIPMENT", "2026-01-11T10:00")];
    const before = computeAvailableStock({ qtyBox: 100, uploadedAt: T("2026-01-10T09:00") }, adjustments);
    expect(before.available).toBe(65);
    const after = computeAvailableStock({ qtyBox: 90, uploadedAt: T("2026-01-11T09:00") }, adjustments);
    expect(after.available).toBe(85);
    expect(after.deductions.SHIPMENT).toBe(5);
  });

  it("불량 차감은 기본값으로 리셋하지 않고 누적한다", () => {
    const adjustments = [adj(4, "DEFECT", "2026-01-10T10:00"), adj(1, "DEFECT", "2026-01-11T10:00")];
    const r = computeAvailableStock({ qtyBox: 90, uploadedAt: T("2026-01-11T09:00") }, adjustments);
    expect(r.deductions.DEFECT).toBe(5);
    expect(r.available).toBe(85);
  });

  it("DEFECT_RESET_ON_UPLOAD=true면 불량도 업로드 이후만 차감", () => {
    const adjustments = [adj(4, "DEFECT", "2026-01-10T10:00"), adj(1, "DEFECT", "2026-01-11T10:00")];
    const r = computeAvailableStock({ qtyBox: 90, uploadedAt: T("2026-01-11T09:00") }, adjustments, {
      defectResetOnUpload: true,
    });
    expect(r.deductions.DEFECT).toBe(1);
    expect(r.available).toBe(89);
  });

  it("기초재고가 없으면 0에서 차감하고 hasBaseline=false", () => {
    const r = computeAvailableStock(null, [adj(2, "SHIPMENT", "2026-01-10T10:00")]);
    expect(r.hasBaseline).toBe(false);
    expect(r.baseline).toBe(0);
    expect(r.available).toBe(-2);
  });

  it("오늘 차감 합계는 오늘 날짜의 미취소 변동만 센다", () => {
    const now = T("2026-01-11T15:00");
    const r = computeAvailableStock(
      { qtyBox: 100, uploadedAt: T("2026-01-10T09:00") },
      [
        adj(10, "SHIPMENT", "2026-01-10T10:00"),
        adj(7, "SHIPMENT", "2026-01-11T08:00"),
        adj(1, "DEFECT", "2026-01-11T09:00"),
        adj(9, "SHIPMENT", "2026-01-11T09:30", "2026-01-11T09:40"),
      ],
      { now },
    );
    expect(r.todayDeduction).toBe(8);
  });
});
