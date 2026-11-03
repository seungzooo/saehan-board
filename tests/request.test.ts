import { describe, expect, it } from "vitest";
import { boxInputAllowed, copyText, judgeRequest, qtyText, stockUnits, type StockForRequest } from "@/lib/request";

const at = "2026-11-04T00:00:00.000Z"; // 서울 09:00
const ea: StockForRequest = { code: "T1", name: "시험 낱개", packUnit: "없음", unitsPerBox: 1, available: 90, basisAt: at, stale: false };
const box: StockForRequest = { code: "T2", name: "시험 박스", packUnit: "박스", unitsPerBox: 100, available: 90, basisAt: at, stale: false };

describe("요청 수량 판정 (목록·상세·계산기·복사 공용)", () => {
  it("요청 100개 · 현재 90개 · 10개 부족", () => {
    const j = judgeRequest(ea, "100", "EA");
    expect(j).toMatchObject({ kind: "SHORT", requestUnits: 100, currentUnits: 90, diff: -10 });
    expect(j.line).toBe("요청 100개 · 현재 90개 · 10개 부족");
  });

  it("충족이면 남는 수량, 딱 맞으면 남음 없이", () => {
    expect(judgeRequest(ea, "60", "EA").line).toBe("요청 60개 · 현재 90개 · 충족 (30개 남음)");
    expect(judgeRequest(ea, "90", "EA").line).toBe("요청 90개 · 현재 90개 · 충족");
  });

  it("개↔박스 환산: 현재 90박스 = 9,000개. 2박스 요청 = 200개, 95박스 요청 = 500개(5박스) 부족", () => {
    expect(stockUnits(box)).toBe(9000);
    expect(qtyText(9050, box)).toBe("9,050개 (90박스 50개)");
    expect(judgeRequest(box, "2", "BOX").line).toBe("요청 200개 (2박스) · 현재 9,000개 (90박스) · 충족 (8,800개 (88박스) 남음)");
    expect(judgeRequest(box, "95", "BOX")).toMatchObject({ kind: "SHORT", requestUnits: 9500, diff: -500 });
    expect(judgeRequest(box, "9500", "EA").line).toBe(judgeRequest(box, "95", "BOX").line); // 같은 수량은 같은 결과
  });

  it("박스 입수가 없으면 개 단위만 (박스 입력 거부)", () => {
    expect(boxInputAllowed("없음", 1)).toBe(false);
    expect(boxInputAllowed("박스", 1)).toBe(false);
    expect(boxInputAllowed("83*155", 90)).toBe(false);
    expect(boxInputAllowed("박스", 100)).toBe(true);
    expect(judgeRequest(ea, "1", "BOX").kind).toBe("INVALID");
    expect(qtyText(90, ea)).toBe("90개");
  });

  it("확인 필요·오늘 자료 미반영은 판정 보류, 마지막 확인 수량과 시각만", () => {
    expect(judgeRequest({ ...ea, available: null, basisAt: null }, "100", "EA")).toMatchObject({ kind: "CHECK" });
    const hold = judgeRequest({ ...ea, stale: true }, "100", "EA");
    expect(hold.kind).toBe("HOLD");
    expect(hold.line).toBe("요청 100개 · 마지막 확인 90개 · 집계 2026-11-04 09:00 · 오늘 자료 미반영 — 판정 보류");
    expect(hold.line).not.toContain("부족");
  });

  it("실제 0개는 판정한다 (재고 없음 ≠ 확인 필요), 음수 재고는 0으로 보고 부족 계산", () => {
    expect(judgeRequest({ ...ea, available: 0 }, "5", "EA").line).toBe("요청 5개 · 현재 0개 · 5개 부족");
    expect(judgeRequest({ ...ea, available: -3 }, "5", "EA")).toMatchObject({ kind: "SHORT", diff: -5 });
  });

  it("입력 검사: 빈 값·0·소수", () => {
    expect(judgeRequest(ea, "", "EA").kind).toBe("EMPTY");
    expect(judgeRequest(ea, "0", "EA").kind).toBe("INVALID");
    expect(judgeRequest(ea, "1.5", "EA").kind).toBe("INVALID");
    expect(judgeRequest(ea, "1,000", "EA")).toMatchObject({ kind: "SHORT", requestUnits: 1000 });
  });

  it("복사 문구: 요청·충족 여부·기준 시각, '확보 완료'·'납기 확정' 표현 없음", () => {
    const t = copyText(ea, judgeRequest(ea, "100", "EA"));
    expect(t).toBe("[새한프라텍 재고 확인] 시험 낱개 (T1)\n요청 100개 · 현재 90개 · 10개 부족\n재고 집계 기준 2026-11-04 09:00 · 확인 재고 기준 (출고 예약·납기 미확정)");
    expect(t).not.toMatch(/확보 완료|납기 확정/);
  });
});
