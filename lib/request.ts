/**
 * 영업 요청 수량 판정 — 거래처 목록·품목 상세·계산기·복사 문구가 모두 이 파일 하나를 쓴다 (같은 산식·같은 기준 시각).
 * DB에 의존하지 않는 순수 함수. 테스트: tests/request.test.ts
 *
 * 수량 단위
 *   - 재고 파일 수량(현재 재고)은 품목의 포장 단위 수 = 박스. 낱개 = 현재 재고 × 입수(unitsPerBox).
 *   - 포장단위가 "박스"이고 입수 > 1일 때만 박스로 입력할 수 있다. 그 밖(입수 1·없음·파렛트·규격 코드)은 개 단위만.
 * 판정
 *   - 확인 필요(최신 파일에 없음)·오늘 자료 미반영(기준 시각이 오래됨)은 판정을 보류하고 마지막 확인 수량·시각만 보여준다.
 *   - 결과는 "확인 재고 기준": 실제 출고 예약·배송 일정이 잡힌 것이 아니므로 "확보 완료"·"납기 확정"이라고 쓰지 않는다.
 */
import { formatDateTime } from "@/lib/format";

export type QtyUnit = "EA" | "BOX";

export type StockForRequest = {
  code: string;
  name: string;
  packUnit: string | null;
  unitsPerBox: number;
  /** 현재 재고(박스). null = 확인 필요 */
  available: number | null;
  /** 품목의 재고 기준 시각 (집계 기준 시각, 없으면 반영 시각) */
  basisAt: Date | string | null;
  /** 오늘 자료 미반영 — lib/stockDisplay isStockStale */
  stale: boolean;
};

export function boxInputAllowed(packUnit: string | null, unitsPerBox: number): boolean {
  return (packUnit ?? "").trim() === "박스" && unitsPerBox > 1;
}

const perBox = (s: Pick<StockForRequest, "unitsPerBox">) => Math.max(1, Math.round(s.unitsPerBox || 1));

/** 현재 재고(박스) → 낱개 */
export function stockUnits(s: Pick<StockForRequest, "available" | "unitsPerBox">): number | null {
  return s.available === null ? null : s.available * perBox(s);
}

/** "9,000개 (90박스)" · "2박스 50개" 보조 표기는 박스 입력이 되는 품목만 */
export function qtyText(units: number, s: Pick<StockForRequest, "packUnit" | "unitsPerBox">): string {
  const main = `${units.toLocaleString()}개`;
  if (!boxInputAllowed(s.packUnit, s.unitsPerBox)) return main;
  const n = perBox(s);
  const sign = units < 0 ? "−" : "";
  const abs = Math.abs(units);
  const boxes = Math.floor(abs / n);
  const rest = abs % n;
  const box = rest === 0 ? `${sign}${boxes.toLocaleString()}박스` : boxes === 0 ? `${sign}${rest.toLocaleString()}개` : `${sign}${boxes.toLocaleString()}박스 ${rest.toLocaleString()}개`;
  return `${main} (${box})`;
}

export type Judgement =
  | { kind: "EMPTY" | "INVALID"; line: string }
  | { kind: "OK" | "SHORT"; requestUnits: number; currentUnits: number; diff: number; line: string }
  | { kind: "HOLD" | "CHECK"; requestUnits: number; currentUnits: number | null; line: string };

/** 요청 수량 판정. qty는 입력값(숫자 문자열 허용), unit은 개/박스 */
export function judgeRequest(s: StockForRequest, qtyInput: string | number, unit: QtyUnit): Judgement {
  const raw = typeof qtyInput === "number" ? String(qtyInput) : qtyInput.replace(/[,\s]/g, "");
  if (raw === "") return { kind: "EMPTY", line: "요청 수량을 입력하세요." };
  const qty = Number(raw);
  if (!Number.isInteger(qty) || qty <= 0) return { kind: "INVALID", line: "요청 수량은 1 이상의 정수로 입력하세요." };
  if (unit === "BOX" && !boxInputAllowed(s.packUnit, s.unitsPerBox)) {
    return { kind: "INVALID", line: "이 품목은 박스 입수가 없어 개 단위로만 계산합니다." };
  }
  const requestUnits = unit === "BOX" ? qty * perBox(s) : qty;
  const req = `요청 ${qtyText(requestUnits, s)}`;
  const current = stockUnits(s);
  if (current === null) return { kind: "CHECK", requestUnits, currentUnits: null, line: `${req} · 재고 확인 필요(최근 재고 파일에 없음) — 판정 보류` };
  if (s.stale) {
    const at = s.basisAt ? ` · 집계 ${formatDateTime(s.basisAt)}` : "";
    return { kind: "HOLD", requestUnits, currentUnits: current, line: `${req} · 마지막 확인 ${qtyText(current, s)}${at} · 오늘 자료 미반영 — 판정 보류` };
  }
  const have = Math.max(0, current);
  if (have >= requestUnits) {
    const left = have - requestUnits;
    return { kind: "OK", requestUnits, currentUnits: current, diff: left, line: `${req} · 현재 ${qtyText(current, s)} · 충족${left > 0 ? ` (${qtyText(left, s)} 남음)` : ""}` };
  }
  const short = requestUnits - have;
  return { kind: "SHORT", requestUnits, currentUnits: current, diff: -short, line: `${req} · 현재 ${qtyText(current, s)} · ${qtyText(short, s)} 부족` };
}

/** 메신저에 붙여 넣는 문구: 요청 수량·충족 여부·기준 시각. 예약·납기 확정 표현은 쓰지 않는다 */
export function copyText(s: StockForRequest, j: Judgement): string {
  const at = s.basisAt ? formatDateTime(s.basisAt) : "시각 미확인";
  return [`[새한프라텍 재고 확인] ${s.name} (${s.code})`, j.line, `재고 집계 기준 ${at} · 확인 재고 기준 (출고 예약·납기 미확정)`].join("\n");
}
