import { describe, expect, it } from "vitest";
import type { AvailableStock } from "@/lib/availableStock";
import {
  activeWindow,
  buildList,
  inWindow,
  paginate,
  shiftYm,
  shipUnitLabel,
  sortRows,
  summarize,
  type StockListRow,
} from "@/lib/managed";

const stock = (available: number | null): AvailableStock => ({
  available,
  baseline: available,
  hasBaseline: available !== null,
  uploadedAt: available === null ? null : new Date("2026-01-01T00:00:00Z"),
  stockAsOf: null,
  deductions: { DEFECT: 0, SHIPMENT: 0, ORDER: 0, OTHER: 0 },
  todayDeduction: 0,
});
const row = (p: Partial<StockListRow> & { code: string }): StockListRow => ({
  name: p.code,
  packUnit: "박스",
  unitsPerBox: 10,
  managed: true,
  stock: stock(10),
  days: 5,
  lastShipDate: "2025-12-01",
  recentQty: 0,
  ...p,
});

describe("기준월·기간 경계", () => {
  it("최근 정상·내수 출고일 2025-12-31 → 기준월 2025-12, 12개 달 = 2025-01 ~ 2025-12", () => {
    const w = activeWindow("2025-12-31", 12);
    expect(w).toEqual({ fromYm: "2025-01", toYm: "2025-12" });
    expect(inWindow("2025-01", w)).toBe(true); // 경계 포함
    expect(inWindow("2025-12", w)).toBe(true);
    expect(inWindow("2024-12", w)).toBe(false); // 13번째 달 제외
    expect(inWindow("2026-01", w)).toBe(false);
  });
  it("연도를 넘는 이동", () => {
    expect(shiftYm("2025-03", -11)).toBe("2024-04");
    expect(shiftYm("2025-01", -1)).toBe("2024-12");
    expect(activeWindow("2025-06-03", 12)).toEqual({ fromYm: "2024-07", toYm: "2025-06" });
  });
});

describe("홈 집계 — 관리 대상만, 휴면과 재고는 독립", () => {
  const rows = [
    row({ code: "M1", stock: stock(30), days: 10 }), // 관리·확인
    row({ code: "M2", stock: stock(0), days: 0 }), // 관리·0박스 (확인됨 — 확인 필요 아님)
    row({ code: "M3", stock: stock(null), days: null }), // 관리·확인 필요
    row({ code: "M4", stock: stock(5), days: 2 }), // 관리·곧 소진
    row({ code: "D1", managed: false, stock: stock(40), days: null }), // 휴면이지만 재고 있음
    row({ code: "D2", managed: false, stock: stock(0), days: null }), // 휴면·0박스 → 재고 있음 아님
    row({ code: "D3", managed: false, stock: stock(null), days: null }), // 휴면·확인 필요
  ];
  it("관리 대상 = 확인 + 미확인, 등록 = 관리 + 휴면", () => {
    const s = summarize(rows, 3);
    expect(s).toMatchObject({ registered: 7, managed: 4, checked: 3, unchecked: 1, dormant: 3, dormantWithStock: 1, balanced: true });
    expect(s.low).toBe(2); // M2(0일)·M4(2일) — 관리 대상의 확인된 품목만
  });
  it("0박스는 확인됨, null은 확인 필요", () => {
    const l = buildList(rows, { view: "unchecked", includeDormant: false, q: "", page: 1, size: 50, lowDays: 3 });
    expect(l.items.map((r) => r.code)).toEqual(["M3"]);
    const c = buildList(rows, { view: "checked", includeDormant: false, q: "", page: 1, size: 50, lowDays: 3 });
    expect(c.items.map((r) => r.code)).toContain("M2");
  });
  it("휴면 포함 토글: 미확인 보기에 휴면 확인 필요 품목이 더해진다", () => {
    const l = buildList(rows, { view: "unchecked", includeDormant: true, q: "", page: 1, size: 50, lowDays: 3 });
    expect(l.items.map((r) => r.code).sort()).toEqual(["D3", "M3"]);
  });
  it("휴면이지만 재고 있음 목록", () => {
    const l = buildList(rows, { view: "dormantStock", includeDormant: false, q: "", page: 1, size: 50, lowDays: 3 });
    expect(l.items.map((r) => r.code)).toEqual(["D1"]);
  });
});

describe("정렬", () => {
  it("확인 목록: 소진일수 오름차순, 산정 불가는 마지막 (0일로 바꾸지 않음)", () => {
    const rows = [row({ code: "A", days: null }), row({ code: "B", days: 7 }), row({ code: "C", days: 0 }), row({ code: "D", days: 2.5 })];
    expect(sortRows(rows, "checked").map((r) => r.code)).toEqual(["C", "D", "B", "A"]);
  });
  it("미확인 목록: 3개월 출고량 ↓ → 최근 출고일 ↓ → 품번 ↑", () => {
    const u = (code: string, recentQty: number, lastShipDate: string | null) => row({ code, recentQty, lastShipDate, stock: stock(null), days: null });
    const rows = [u("Z", 10, "2025-11-01"), u("B", 50, "2025-10-01"), u("A", 10, "2025-12-20"), u("C", 10, "2025-12-20"), u("Y", 0, null)];
    expect(sortRows(rows, "unchecked").map((r) => r.code)).toEqual(["B", "A", "C", "Z", "Y"]);
  });
  it("단종(폐기)은 맨 아래", () => {
    const rows = [row({ code: "A", name: "폐기 - 통", days: 0 }), row({ code: "B", days: 9 })];
    expect(sortRows(rows, "checked").map((r) => r.code)).toEqual(["B", "A"]);
  });
});

describe("검색·정렬 후 페이지 분할", () => {
  // 120개: 소진일수가 품번 순서와 반대 → 페이지마다 따로 정렬하면 틀린다
  const rows = Array.from({ length: 120 }, (_, i) => row({ code: `P${String(i).padStart(3, "0")}`, days: 120 - i }));
  it("전체를 정렬한 뒤 50개씩: 1페이지 첫 항목이 전체 최솟값", () => {
    const p1 = buildList(rows, { view: "checked", includeDormant: false, q: "", page: 1, size: 50, lowDays: 3 });
    expect(p1.pages).toBe(3);
    expect(p1.items[0].code).toBe("P119"); // days 1
    const p3 = buildList(rows, { view: "checked", includeDormant: false, q: "", page: 3, size: 50, lowDays: 3 });
    expect(p3.items).toHaveLength(20);
    expect(p3.items.at(-1)!.code).toBe("P000"); // days 120
  });
  it("검색 후 페이지: 대상이 줄면 범위를 넘는 페이지는 마지막으로", () => {
    const l = buildList(rows, { view: "checked", includeDormant: false, q: "p11", page: 3, size: 50, lowDays: 3 });
    expect(l.total).toBe(10); // P110~P119
    expect(l.page).toBe(1);
    expect(l.items[0].code).toBe("P119");
  });
  it("paginate 경계", () => {
    expect(paginate([], 1, 50)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
    expect(paginate([1, 2, 3], 0, 2).page).toBe(1);
  });
});

describe("출고량 단위", () => {
  it("박스·파렛트·필름은 그 이름, 나머지는 포장", () => {
    expect(shipUnitLabel("박스")).toBe("박스");
    expect(shipUnitLabel("파렛트")).toBe("파렛트");
    expect(shipUnitLabel("83*155")).toBe("포장");
    expect(shipUnitLabel("없음")).toBe("포장");
    expect(shipUnitLabel("83*155", 1)).toBe("개"); // 입수 1 → 출고량은 낱개
    expect(shipUnitLabel("박스", 1)).toBe("개");
    expect(shipUnitLabel("박스", 24)).toBe("박스");
  });
});
