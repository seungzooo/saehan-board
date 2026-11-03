/**
 * 관리 대상 / 휴면 분류와 재고 목록 정렬·검색·페이지 — 순수 함수 (DB 없음). 테스트: tests/managed.test.ts
 *
 * 관리 대상 = 기준월 포함 최근 N개 달(ACTIVE_MONTHS)에 정상·내수 출고가 있는 등록 품번.
 * 기준월 = 보유 데이터에서 가장 최근 정상·내수 출고일이 속한 달.
 * 그 밖의 등록 품번 = 휴면. 휴면 여부와 재고 수량(0박스 / 확인 필요)은 서로 독립이다.
 */
import type { AvailableStock } from "@/lib/availableStock";
import { isDiscontinued } from "@/lib/search";

/** "2025-12", -11 → "2025-01" */
export function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** 기준월 포함 최근 months개 달: { fromYm, toYm } (양끝 포함) */
export function activeWindow(latestShipDate: string, months: number): { fromYm: string; toYm: string } {
  const toYm = latestShipDate.slice(0, 7);
  return { fromYm: shiftYm(toYm, -(months - 1)), toYm };
}

export function inWindow(ym: string, w: { fromYm: string; toYm: string }): boolean {
  return ym >= w.fromYm && ym <= w.toYm;
}

export type StockListRow = {
  code: string;
  name: string;
  packUnit: string;
  unitsPerBox: number; // 포장단위수량 — 1이면 출고량은 낱개 수
  managed: boolean; // false = 휴면
  stock: AvailableStock; // available null = 확인 필요, 0 = 0박스
  days: number | null; // 예상 소진일수, null = 산정 불가
  lastShipDate: string | null; // 최근 정상·내수 출고일 (전 기간)
  recentQty: number; // 기준월 포함 최근 3개 달 정상·내수 출고량 (포장단위 수)
};

export type ListView = "all" | "checked" | "unchecked" | "low" | "dormant" | "dormantStock";

export const isChecked = (r: StockListRow) => r.stock.available !== null;
/** 휴면이지만 재고 있음: 휴면 + 최근 재고 파일에 있음 + 현재 재고 > 0 */
export const isDormantWithStock = (r: StockListRow) => !r.managed && r.stock.available !== null && r.stock.available > 0;

/** 홈 집계 — 관리 대상만. managed = checked + unchecked 가 항상 성립해야 한다 */
export function summarize(rows: StockListRow[], lowDays: number) {
  const managed = rows.filter((r) => r.managed);
  const checked = managed.filter(isChecked);
  const unchecked = managed.filter((r) => !isChecked(r));
  const dormant = rows.filter((r) => !r.managed);
  const low = checked.filter((r) => r.days !== null && r.days <= lowDays);
  return {
    registered: rows.length,
    managed: managed.length,
    checked: checked.length,
    unchecked: unchecked.length,
    dormant: dormant.length,
    dormantWithStock: dormant.filter(isDormantWithStock).length,
    low: low.length,
    balanced: managed.length === checked.length + unchecked.length && rows.length === managed.length + dormant.length,
  };
}

/** 보기(view)별 대상. includeDormant면 확인/미확인/전체 보기에 휴면 품목도 포함 */
export function selectView(rows: StockListRow[], view: ListView, includeDormant: boolean, lowDays: number): StockListRow[] {
  const scope = includeDormant ? rows : rows.filter((r) => r.managed);
  switch (view) {
    case "checked":
      return scope.filter(isChecked);
    case "unchecked":
      return scope.filter((r) => !isChecked(r));
    case "low":
      return scope.filter((r) => isChecked(r) && r.days !== null && r.days <= lowDays);
    case "dormant":
      return rows.filter((r) => !r.managed);
    case "dormantStock":
      return rows.filter(isDormantWithStock);
    default:
      return scope;
  }
}

/** 목록 안 검색: 품명·품번 부분일치 (대소문자 무시). 공백으로 나눈 단어 모두 포함 */
export function filterRows(rows: StockListRow[], q: string): StockListRow[] {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((r) => terms.every((t) => r.name.toLowerCase().includes(t) || r.code.toLowerCase().includes(t)));
}

const byCode = (a: StockListRow, b: StockListRow) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
const desc = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1);

/** 확인 목록: 소진일수 오름차순, 산정 불가(null)는 마지막 (0일로 바꾸지 않는다) */
export function compareChecked(a: StockListRow, b: StockListRow): number {
  if (a.days === null && b.days !== null) return 1;
  if (b.days === null && a.days !== null) return -1;
  if (a.days !== null && b.days !== null && a.days !== b.days) return a.days - b.days;
  return byCode(a, b);
}

/** 미확인 목록: 최근 3개 달 출고량 내림차순 → 최근 출고일 내림차순 → 품번 오름차순 */
export function compareUnchecked(a: StockListRow, b: StockListRow): number {
  if (a.recentQty !== b.recentQty) return b.recentQty - a.recentQty;
  return desc(a.lastShipDate, b.lastShipDate) || byCode(a, b);
}

/** 보기별 정렬. 단종(품명 "폐기"로 시작)은 어느 보기에서든 맨 아래 */
export function sortRows(rows: StockListRow[], view: ListView): StockListRow[] {
  const cmp = (a: StockListRow, b: StockListRow): number => {
    const d = Number(isDiscontinued(a.name)) - Number(isDiscontinued(b.name));
    if (d) return d;
    switch (view) {
      case "checked":
      case "low":
        return compareChecked(a, b);
      case "unchecked":
        return compareUnchecked(a, b);
      case "dormantStock":
        return (b.stock.available ?? 0) - (a.stock.available ?? 0) || byCode(a, b);
      case "dormant":
        return desc(a.lastShipDate, b.lastShipDate) || byCode(a, b);
      default: {
        // 전체: 확인된 품목(소진일수 순) → 확인 필요(출고량 순)
        const g = Number(!isChecked(a)) - Number(!isChecked(b));
        if (g) return g;
        return isChecked(a) ? compareChecked(a, b) : compareUnchecked(a, b);
      }
    }
  };
  return [...rows].sort(cmp);
}

/** 정렬된 전체에서 page(1부터)를 자른다. 범위를 넘으면 마지막 페이지 */
export function paginate<T>(rows: T[], page: number, size: number): { items: T[]; page: number; pages: number; total: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: rows.slice((p - 1) * size, p * size), page: p, pages, total: rows.length };
}

/** 필터 → 검색 → 정렬 → 페이지 (이 순서가 바뀌면 페이지마다 따로 정렬되는 버그가 된다) */
export function buildList(
  rows: StockListRow[],
  opts: { view: ListView; includeDormant: boolean; q: string; page: number; size: number; lowDays: number },
) {
  const selected = selectView(rows, opts.view, opts.includeDormant, opts.lowDays);
  const found = filterRows(selected, opts.q);
  return paginate(sortRows(found, opts.view), opts.page, opts.size);
}

/**
 * 출고량 단위. 출고 박스 환산 = 출고수량 ÷ 포장단위수량이므로:
 *   포장단위수량 1 → "개" (낱개 수 그대로 — 판매실적에 입수가 1로 들어온 품목, 2026-11 기준 88개)
 *   박스·파렛트·필름 → 그 이름, 그 밖(83*155·없음 등) → "포장"
 */
export function shipUnitLabel(packUnit: string | null | undefined, unitsPerBox?: number): string {
  if (unitsPerBox === 1) return "개";
  const u = (packUnit ?? "").trim();
  return ["박스", "파렛트", "필름"].includes(u) ? u : "포장";
}
