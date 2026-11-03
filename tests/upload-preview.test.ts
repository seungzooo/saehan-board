/**
 * 재고 업로드 미리보기(신규/변경/누락), MERGE 이월, 복구 — 가짜 Prisma로 검증. 운영 DB에 쓰지 않는다.
 */
import iconv from "iconv-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { previewStock, processUpload, revertLatestStock } from "@/lib/excel/upload";
import { computeAvailableStock } from "@/lib/availableStock";
import { basisText } from "@/lib/stockDisplay";

vi.mock("@/lib/db", () => ({ prisma: {} }));

type Batch = {
  id: string;
  kind: string;
  fileName: string;
  fileHash: string;
  uploadedAt: Date;
  stockAsOf: Date | null;
  defectApplied: boolean;
  mode: string;
  revertedAt: Date | null;
};
type Snap = { productCode: string; qtyBox: number; batchId: string; stockAsOf: Date | null; uploadedAt: Date; carried?: boolean };

/** 가짜 findFirst의 where 해석: 값 비교, fileHash.startsWith, 날짜 비교 */
function matches(row: Record<string, unknown>, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(([k, v]) => {
    const x = row[k];
    if (v && typeof v === "object" && "startsWith" in (v as object)) return typeof x === "string" && x.startsWith((v as { startsWith: string }).startsWith);
    if (v instanceof Date || x instanceof Date) return (x as Date | null)?.getTime?.() === (v as Date | null)?.getTime?.() || (x == null && v == null);
    return (x ?? null) === (v ?? null);
  });
}

function makeFakeDb(productNames: Record<string, string>) {
  const state = { batches: [] as Batch[], snapshots: [] as Snap[] };
  let seq = 0;
  // 같은 밀리초에 업로드돼도 결정적으로: 시각이 같으면 나중에 넣은 배치가 최신
  const latest = (s: typeof state) =>
    s.batches
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.kind === "STOCK" && !b.revertedAt)
      .sort((x, y) => y.b.uploadedAt.getTime() - x.b.uploadedAt.getTime() || y.i - x.i)[0]?.b ?? null;
  const client = (s: typeof state) => ({
    uploadBatch: {
      findUnique: async ({ where }: { where: { fileHash: string } }) => s.batches.find((b) => b.fileHash === where.fileHash) ?? null,
      // where가 kind·revertedAt만이면 최신 배치(latestStockBatch), 그 밖의 조건은 그대로 걸러서 최신 것
      findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const rows = s.batches.filter((b) => matches(b as unknown as Record<string, unknown>, where));
        const l = latest({ ...s, batches: rows });
        return l ?? (rows.length ? rows[rows.length - 1] : null);
      },
      create: async ({ data }: { data: Omit<Batch, "id" | "revertedAt"> }) => {
        const b: Batch = { id: `b${++seq}`, revertedAt: null, ...data };
        s.batches.push(b);
        return b;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Batch> }) => {
        const b = s.batches.find((x) => x.id === where.id)!;
        Object.assign(b, data);
        return b;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        s.batches = s.batches.filter((b) => b.id !== where.id);
      },
    },
    product: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) =>
        where.code.in.filter((c) => c in productNames).map((code) => ({ code, name: productNames[code] })),
    },
    stockSnapshot: {
      createMany: async ({ data }: { data: Snap[] }) => {
        s.snapshots.push(...data);
        return { count: data.length };
      },
      findMany: async ({ where }: { where: { batchId: string; productCode?: { notIn: string[] } } }) =>
        s.snapshots
          .filter((x) => x.batchId === where.batchId && !(where.productCode?.notIn ?? []).includes(x.productCode))
          .map((x) => ({ ...x, product: { name: productNames[x.productCode] } })),
      deleteMany: async ({ where }: { where: { batchId: string } }) => {
        s.snapshots = s.snapshots.filter((x) => x.batchId !== where.batchId);
      },
    },
  });
  const db = {
    ...client(state),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const draft = { batches: [...state.batches], snapshots: [...state.snapshots] };
      const result = await fn(client(draft));
      state.batches = draft.batches;
      state.snapshots = draft.snapshots;
      return result;
    },
  };
  return { db: db as unknown as PrismaClient, state, latest: () => latest(state) };
}

const cp949 = (text: string) => new Uint8Array(iconv.encode(text, "cp949"));
const DAY1 = "품번\t재고수량\r\nA\t100\r\nB\t50\r\nC\t7\r\n";
const DAY2 = "품번\t재고수량\r\nA\t90\r\nB\t50\r\nD\t3\r\nZZ\t1\r\n"; // C 누락, D 신규, A 변경, ZZ 품번 불일치

describe("재고 업로드 미리보기 / MERGE / 복구", () => {
  let fake: ReturnType<typeof makeFakeDb>;
  beforeEach(async () => {
    fake = makeFakeDb({ A: "에이", B: "비", C: "씨", D: "디" });
    const r = await processUpload("STOCK", "day1.xls", cp949(DAY1), "t", {}, fake.db);
    expect(r.status).toBe("saved");
  });

  it("미리보기: 기존 대비 신규 1 / 변경 1 / 누락 1, 동일 1, 품번 불일치 1", async () => {
    const p = await previewStock(cp949(DAY2), fake.db);
    expect(p.status).toBe("ok");
    if (p.status !== "ok") return;
    expect({ added: p.added, changed: p.changed, same: p.same, missing: p.missing }).toEqual({ added: 1, changed: 1, same: 1, missing: 1 });
    expect(p.changedSample).toEqual([{ code: "A", name: "에이", before: 100, after: 90 }]);
    expect(p.missingSample).toEqual([{ code: "C", name: "씨", qtyBox: 7 }]);
    expect(p.errors.map((e) => e.kind)).toEqual(["CODE"]);
    expect(p.previousBatch?.fileName).toBe("day1.xls");
    expect(p.duplicate).toBeNull();
    expect(fake.state.batches).toHaveLength(1); // 저장하지 않음
  });

  it("전체 교체: 파일에 없는 C는 새 배치에 없다 (→ 재고 확인 필요)", async () => {
    const r = await processUpload("STOCK", "day2.xls", cp949(DAY2), "t", { mode: "REPLACE", allowRowErrors: true }, fake.db);
    expect(r.status).toBe("saved");
    const b = fake.latest()!;
    const codes = fake.state.snapshots.filter((s) => s.batchId === b.id).map((s) => s.productCode).sort();
    expect(codes).toEqual(["A", "B", "D"]);
    expect(b.mode).toBe("REPLACE");
  });

  it("있는 품목만 갱신(MERGE): C는 직전 수량 7로 이월된다", async () => {
    const r = await processUpload("STOCK", "day2.xls", cp949(DAY2), "t", { mode: "MERGE", allowRowErrors: true }, fake.db);
    expect(r.status).toBe("saved");
    if (r.status !== "saved") return;
    expect(r.result.carried).toBe(1);
    expect(r.result.inserted).toBe(3);
    const b = fake.latest()!;
    const snaps = fake.state.snapshots.filter((s) => s.batchId === b.id);
    expect(Object.fromEntries(snaps.map((s) => [s.productCode, s.qtyBox]))).toEqual({ A: 90, B: 50, D: 3, C: 7 });
  });

  it("복구: 최신 배치를 되돌리면 직전 배치가 다시 기준이 되고, 같은 파일을 다시 올릴 수 있다", async () => {
    await processUpload("STOCK", "day2.xls", cp949(DAY2), "t", { allowRowErrors: true }, fake.db);
    const day2 = fake.latest()!;
    const rv = await revertLatestStock(day2.id, fake.db);
    expect(rv.ok).toBe(true);
    if (!rv.ok) return;
    expect(rv.nowBasis?.fileName).toBe("day1.xls");
    expect(fake.latest()!.fileName).toBe("day1.xls");
    expect(fake.state.batches).toHaveLength(2); // 지우지 않고 revertedAt만 기록

    const again = await processUpload("STOCK", "day2-again.xls", cp949(DAY2), "t", { allowRowErrors: true }, fake.db);
    expect(again.status).toBe("saved"); // 복구된 배치는 중복으로 보지 않는다
    expect(fake.state.batches.filter((b) => b.fileName === "day2.xls")).toHaveLength(0); // 복구된 옛 배치는 교체됨
  });

  it("복구: 그 사이 다른 업로드가 있었으면 거부", async () => {
    const day1 = fake.latest()!;
    await processUpload("STOCK", "day2.xls", cp949(DAY2), "t", { allowRowErrors: true }, fake.db);
    const rv = await revertLatestStock(day1.id, fake.db);
    expect(rv.ok).toBe(false);
  });

  it("미리보기: 같은 품번 두 줄이면 '중복 품번 1개', 합산하지 않는다", async () => {
    const p = await previewStock(cp949("품번\t재고수량\r\nA\t40\r\nB\t50\r\nA\t60\r\n"), fake.db);
    expect(p.status).toBe("ok");
    if (p.status !== "ok") return;
    expect(p.duplicateCodes).toBe(1);
    expect(p.errors.filter((e) => e.kind === "DUP").map((e) => e.row)).toEqual([2, 4]);
    expect(p.fileProducts).toBe(1); // B만 정상
    expect(p.missing).toBe(2); // 기존 A·C가 이번 파일 정상 행에 없음 → 확인 필요
  });
});

describe("일부 갱신: 파일에 없는 품목은 이전 수량과 이전 집계 시각 유지", () => {
  const kst = (s: string) => new Date(`${s}+09:00`);
  it("11-03 09:00 전체 파일(A·B) → 11-04 10:00 일부 갱신(A만) → A는 11-04 10:00, B는 11-03 09:00 기준", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeDb({ A: "에이", B: "비" });
      vi.setSystemTime(kst("2026-11-03T09:03:00"));
      const full = await processUpload("STOCK", "full.xls", cp949("품번\t재고수량\r\nA\t100\r\nB\t50\r\n"), "t", { stockAsOf: kst("2026-11-03T09:00:00") }, fake.db);
      expect(full.status).toBe("saved");
      vi.setSystemTime(kst("2026-11-04T10:05:00"));
      const part = await processUpload("STOCK", "partA.xls", cp949("품번\t재고수량\r\nA\t80\r\n"), "t", { stockAsOf: kst("2026-11-04T10:00:00"), mode: "MERGE" }, fake.db);
      expect(part.status).toBe("saved");

      const b = fake.latest()!;
      expect(b.fileName).toBe("partA.xls");
      const snap = (code: string) => fake.state.snapshots.find((x) => x.batchId === b.id && x.productCode === code)!;
      expect(snap("A")).toMatchObject({ qtyBox: 80, carried: false });
      expect(snap("B")).toMatchObject({ qtyBox: 50, carried: true });
      expect(snap("A").stockAsOf).toEqual(kst("2026-11-04T10:00:00"));
      expect(snap("B").stockAsOf).toEqual(kst("2026-11-03T09:00:00"));
      expect(snap("B").uploadedAt).toEqual(kst("2026-11-03T09:03:00")); // 반영 시각도 원래 값

      // 화면 문구 (상세 = long)
      expect(basisText(snap("A"), true)).toBe("재고 집계 기준 2026-11-03 10:00 · 파일 반영 2026-11-03 10:05".replace(/11-03/g, "11-04"));
      expect(basisText(snap("B"), true)).toBe("재고 집계 기준 2026-11-03 09:00 · 파일 반영 2026-11-03 09:03");
      expect(basisText(snap("B"))).toBe("재고 집계 기준 11-03 09:00 · 파일 반영 11-03 09:03");

      // B는 11-03 09:00 이후 입력한 출고가 계속 차감된다 (새 파일이 B를 다시 세지 않았으므로)
      const adj = [{ qtyBox: 5, reason: "SHIPMENT", createdAt: kst("2026-11-03T15:00:00"), cancelledAt: null }];
      expect(computeAvailableStock(snap("B"), adj).available).toBe(45);
      expect(computeAvailableStock(snap("A"), adj).available).toBe(80); // A는 10:00 파일이 반영
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("시연: 재고 90(집계 09:00) → 09:05 불량 5 → 09:12 같은 파일을 '불량 반영됨'으로 다시 반영", () => {
  const kst = (s: string) => new Date(`${s}+09:00`);
  it("같은 파일도 불량 반영 선택이 다르면 새 기준이 되고, 결과는 85박스 · 집계 09:00", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeDb({ A: "에이" });
      const file = cp949("품번\t재고수량\r\nA\t90\r\n");
      const asOf = kst("2026-11-03T09:00:00");
      vi.setSystemTime(kst("2026-11-03T09:01:00"));
      expect((await processUpload("STOCK", "stock.xls", file, "t", { stockAsOf: asOf }, fake.db)).status).toBe("saved");
      const defect = { qtyBox: 5, reason: "DEFECT", createdAt: kst("2026-11-03T09:05:00"), cancelledAt: null };

      vi.setSystemTime(kst("2026-11-03T09:12:00"));
      const p = await previewStock(file, fake.db);
      expect(p.status === "ok" && p.duplicate?.defectApplied).toBe(false); // 같은 파일 안내, 저장은 막지 않음
      const again = await processUpload("STOCK", "stock.xls", file, "t", { stockAsOf: asOf, defectApplied: true }, fake.db);
      expect(again.status).toBe("saved");
      const b = fake.latest()!;
      expect(b.defectApplied).toBe(true);
      const snap = fake.state.snapshots.find((x) => x.batchId === b.id)!;
      // 불량 리셋 시점 = 이 파일의 집계 시각 09:00 → 09:05 불량은 파일에 없으므로 계속 차감
      const s = computeAvailableStock({ ...snap, defectResetAt: asOf }, [defect]);
      expect(s.available).toBe(85);
      expect(basisText(s as { uploadedAt: Date; stockAsOf: Date | null })).toBe("재고 집계 기준 11-03 09:00 · 파일 반영 11-03 09:12");
      // 같은 설정으로 한 번 더 → 중복
      expect((await processUpload("STOCK", "stock.xls", file, "t", { stockAsOf: asOf, defectApplied: true }, fake.db)).status).toBe("duplicate");
    } finally {
      vi.useRealTimers();
    }
  });
});
