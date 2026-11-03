/**
 * 재고 업로드 미리보기(신규/변경/누락), MERGE 이월, 복구 — 가짜 Prisma로 검증. 운영 DB에 쓰지 않는다.
 */
import iconv from "iconv-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { previewStock, processUpload, revertLatestStock } from "@/lib/excel/upload";

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
type Snap = { productCode: string; qtyBox: number; batchId: string; stockAsOf: Date | null; uploadedAt: Date };

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
      findFirst: async () => latest(s),
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
});
