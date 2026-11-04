import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
import { topPeriods } from "@/lib/analytics/customerTop";
import { buildContext } from "@/lib/analytics/periods";

describe("거래선 TOP 10 기간 선택", () => {
  const months = Array.from({ length: 63 }, (_, i) => `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`); // 2021-01 ~ 2026-03
  it("최근 12개월(집계 완료 마지막 달 기준) + 연도별(그해 완료된 달만)", () => {
    const ctx = buildContext(months, "2026-02"); // 2026-03은 집계 중
    const p = topPeriods(ctx);
    expect(p[0]).toEqual({ key: "recent", label: "최근 12개월", from: "2025-03", to: "2026-02", months: 12 });
    expect(p[1]).toEqual({ key: "2026", label: "2026년 (1~2월)", from: "2026-01", to: "2026-02", months: 2 });
    expect(p[2]).toMatchObject({ key: "2025", label: "2025년", from: "2025-01", to: "2025-12" });
  });
});
