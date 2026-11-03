import { describe, expect, it } from "vitest";
import { effectiveCompletion, lastBusinessDay, suggestCompleteMonth, validateCompleteMonth } from "@/lib/analytics/completion";
import { buildContext, compareYear, describeComparison, monthStatus, yearSpan } from "@/lib/analytics/periods";

const months = (from: string, to: string) => {
  const out: string[] = [];
  for (let [y, m] = from.split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((m = 1), y++) : m++)
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};

describe("기본 제안 — 마지막 출고일이 그 달 말일(또는 마지막 영업일)이면 그 달, 아니면 전달", () => {
  it("2026-03-15 → 2026-02", () => expect(suggestCompleteMonth("2026-03-15")).toBe("2026-02"));
  it("2026-03-31 → 2026-03", () => expect(suggestCompleteMonth("2026-03-31")).toBe("2026-03"));
  it("말일이 주말이면 마지막 영업일(금)까지 출고가 있으면 그 달", () => {
    expect(lastBusinessDay("2026-05")).toBe("2026-05-29"); // 30·31일 토·일
    expect(suggestCompleteMonth("2026-05-29")).toBe("2026-05");
    expect(suggestCompleteMonth("2026-05-28")).toBe("2026-04");
  });
  it("1월 중순 → 전년 12월", () => expect(suggestCompleteMonth("2026-01-10")).toBe("2025-12"));
  it("2025-12-31 (기존 정리본) → 2025-12", () => expect(suggestCompleteMonth("2025-12-31")).toBe("2025-12"));
});

describe("2026-03-15까지 있는 파일 업로드 시나리오", () => {
  // 2025-01 ~ 2026-03 자료, 2026-03은 15일까지
  const present = months("2025-01", "2026-03");
  const totals = new Map<string, number>(present.map((m) => [m, m.startsWith("2026") ? 120 : 100]));

  it("기본 제안 2026-02 → 2026-03은 '집계 중'으로 비교에서 제외 (2026년 1~2월 vs 2025년 1~2월)", () => {
    const ctx = buildContext(present, suggestCompleteMonth("2026-03-15"));
    expect(ctx.completeThrough).toBe("2026-02");
    expect(monthStatus("2026-03", ctx)).toBe("incomplete");
    expect(yearSpan(2026, ctx)).toEqual({ from: 1, to: 2 });
    const c = compareYear(2026, totals, ctx);
    expect(describeComparison(c, null)).toEqual(["2026년 1~2월 240개", "2025년 1~2월 200개", "전년 동기간 대비 +20.0%"]);
  });

  it("담당자가 2026-03으로 바꾸면 3월도 비교에 포함 (2026년 1~3월 vs 2025년 1~3월)", () => {
    const ctx = buildContext(present, "2026-03");
    expect(monthStatus("2026-03", ctx)).toBe("ok");
    expect(describeComparison(compareYear(2026, totals, ctx), null)).toEqual([
      "2026년 1~3월 360개",
      "2025년 1~3월 300개",
      "전년 동기간 대비 +20.0%",
    ]);
  });
});

describe("앱이 쓰는 값 — 가장 최근 배치", () => {
  const b = (id: string, uploadedAt: string, completeThrough: string | null, revertedAt: string | null = null, kind = "SALES") => ({
    id,
    kind,
    fileName: `${id}.xls`,
    uploadedAt,
    completeThrough,
    revertedAt,
  });
  it("가장 최근에 올린 배치의 값, 복구된 배치·값 없는 배치·다른 종류는 제외", () => {
    const list = [
      b("seed", "2025-12-31T15:00:00Z", "2025-12"),
      b("mar", "2026-03-16T01:00:00Z", "2026-02"),
      b("reverted", "2026-03-17T01:00:00Z", "2026-03", "2026-03-17T02:00:00Z"),
      b("prod", "2026-03-18T01:00:00Z", "2026-03", null, "PRODUCTION"),
      b("noval", "2026-03-19T01:00:00Z", null),
    ];
    expect(effectiveCompletion(list, "SALES")?.id).toBe("mar");
    expect(effectiveCompletion(list, "PRODUCTION")?.id).toBe("prod");
    expect(effectiveCompletion([], "SALES")).toBeNull();
  });
});

describe("입력 검증", () => {
  it("형식과 파일 범위", () => {
    expect(validateCompleteMonth("2026-03", "2026-03")).toBeNull();
    expect(validateCompleteMonth("2026-04", "2026-03")).toMatch(/늦을 수 없습니다/);
    expect(validateCompleteMonth("2026-13", null)).toMatch(/형식/);
    expect(validateCompleteMonth("26-03", null)).toMatch(/형식/);
  });
});
