import { describe, expect, it } from "vitest";
import { computeAvailableStock, type AdjustmentLike } from "@/lib/availableStock";

// 시간대 없는 문자열은 서울(+09:00)로 해석 — 서버 TZ와 무관하게 동일한 결과
const T = (s: string) => new Date(`${s}+09:00`);
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

  describe("사후 불량 반영 여부 (배치별)", () => {
    const defect10 = [adj(10, "DEFECT", "2026-01-10T10:00")];

    it("불량 10 입력 후 '반영됨' 90 업로드 → 90 (이전 불량 리셋)", () => {
      const r = computeAvailableStock(
        { qtyBox: 90, uploadedAt: T("2026-01-11T09:00"), defectResetAt: T("2026-01-11T09:00") },
        defect10,
      );
      expect(r.available).toBe(90);
      expect(r.deductions.DEFECT).toBe(0);
    });

    it("불량 10 입력 후 '미반영' 100 업로드 → 90 (불량 유지)", () => {
      const r = computeAvailableStock({ qtyBox: 100, uploadedAt: T("2026-01-11T09:00"), defectResetAt: null }, defect10);
      expect(r.available).toBe(90);
      expect(r.deductions.DEFECT).toBe(10);
    });

    it("'반영됨' 업로드 뒤에 입력한 불량은 다시 차감된다", () => {
      const r = computeAvailableStock(
        { qtyBox: 90, uploadedAt: T("2026-01-11T09:00"), defectResetAt: T("2026-01-11T09:00") },
        [...defect10, adj(4, "DEFECT", "2026-01-11T15:00")],
      );
      expect(r.available).toBe(86);
    });

    it("리셋 시점은 가장 최근 '반영됨' 배치 — 이후 '미반영' 배치가 와도 유지된다", () => {
      // 01-11 반영됨(리셋), 01-12 미반영 100 업로드. 01-10 불량은 계속 무시, 01-11 15:00 불량만 차감
      const r = computeAvailableStock(
        { qtyBox: 100, uploadedAt: T("2026-01-12T09:00"), defectResetAt: T("2026-01-11T09:00") },
        [...defect10, adj(4, "DEFECT", "2026-01-11T15:00")],
      );
      expect(r.available).toBe(96);
    });
  });

  describe("확인 필요 vs 0박스", () => {
    it("최근 재고 파일에 없는 품목은 available=null (음수 계산 금지)", () => {
      const r = computeAvailableStock(null, [adj(2, "SHIPMENT", "2026-01-10T10:00")]);
      expect(r.hasBaseline).toBe(false);
      expect(r.available).toBeNull();
      expect(r.baseline).toBeNull();
      expect(r.deductions.SHIPMENT).toBe(2); // 내역은 그대로 보여준다
    });

    it("파일에 0으로 있는 품목은 available=0", () => {
      const r = computeAvailableStock({ qtyBox: 0, uploadedAt: T("2026-01-10T09:00") }, []);
      expect(r.hasBaseline).toBe(true);
      expect(r.available).toBe(0);
    });

    it("집계 기준 시각은 그대로 전달된다", () => {
      const r = computeAvailableStock(
        { qtyBox: 5, uploadedAt: T("2026-01-10T09:12"), stockAsOf: T("2026-01-10T09:00") },
        [],
      );
      expect(r.stockAsOf?.toISOString()).toBe(T("2026-01-10T09:00").toISOString());
      expect(r.uploadedAt?.toISOString()).toBe(T("2026-01-10T09:12").toISOString());
    });
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

  describe("수주 → 출고 이중 차감 방지", () => {
    const base = { qtyBox: 100, uploadedAt: T("2026-01-10T09:00") };
    const order = { ...adj(20, "ORDER", "2026-01-10T10:00"), id: 1 };

    it("기초 100 → 수주 20 → 가용 80", () => {
      expect(computeAvailableStock(base, [order]).available).toBe(80);
    });

    it("그 수주를 출고로 등록(orderId 연결) → 가용 80 (수주 차감 해제)", () => {
      const ship = { ...adj(20, "SHIPMENT", "2026-01-10T14:00"), id: 2, orderId: 1 };
      const r = computeAvailableStock(base, [order, ship]);
      expect(r.available).toBe(80);
      expect(r.deductions).toMatchObject({ ORDER: 0, SHIPMENT: 20 });
    });

    it("연결 없이 출고하면 둘 다 차감된다 (60) — 연결이 이중 차감을 막는 유일한 수단", () => {
      const ship = { ...adj(20, "SHIPMENT", "2026-01-10T14:00"), id: 2 };
      expect(computeAvailableStock(base, [order, ship]).available).toBe(60);
    });

    it("연결된 출고가 취소되면 수주 차감이 되살아난다 (80)", () => {
      const ship = { ...adj(20, "SHIPMENT", "2026-01-10T14:00", "2026-01-10T15:00"), id: 2, orderId: 1 };
      const r = computeAvailableStock(base, [order, ship]);
      expect(r.available).toBe(80);
      expect(r.deductions).toMatchObject({ ORDER: 20, SHIPMENT: 0 });
    });

    it("부분 출고(수주 20 중 출고 15)도 연결하면 수주 전체가 해제되어 85", () => {
      const ship = { ...adj(15, "SHIPMENT", "2026-01-10T14:00"), id: 2, orderId: 1 };
      expect(computeAvailableStock(base, [order, ship]).available).toBe(85);
    });
  });
});
