import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatShort, isSameSeoulDay } from "@/lib/format";

describe("format (Asia/Seoul)", () => {
  it("UTC 시각을 서울 시각으로 표시한다 (서버 시간대와 무관)", () => {
    const d = new Date("2026-01-10T16:30:00Z"); // 서울 01-11 01:30
    expect(formatDateTime(d)).toBe("2026-01-11 01:30");
    expect(formatDate(d)).toBe("2026-01-11");
    expect(formatShort(d)).toBe("01-11 01:30");
    expect(formatDateTime("2026-01-10T16:30:00Z")).toBe("2026-01-11 01:30");
  });
  it("자정 전후도 24시간제", () => {
    expect(formatDateTime(new Date("2026-01-10T15:00:00Z"))).toBe("2026-01-11 00:00");
    expect(formatDateTime(new Date("2026-01-10T03:05:00Z"))).toBe("2026-01-10 12:05");
  });
  it("같은 서울 날짜 판정", () => {
    expect(isSameSeoulDay(new Date("2026-01-10T15:00:00Z"), new Date("2026-01-11T14:59:00Z"))).toBe(true);
    expect(isSameSeoulDay(new Date("2026-01-10T14:59:00Z"), new Date("2026-01-10T15:00:00Z"))).toBe(false);
  });
});
