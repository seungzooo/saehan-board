/**
 * 잘못된 재고 파일을 올려도 직전 기준(마지막 정상 배치·수량·집계 시각)이 유지되는지.
 * DB 대신 트랜잭션 롤백을 흉내 내는 가짜 Prisma를 쓴다 — 운영 DB에 쓰지 않는다.
 */
import iconv from "iconv-lite";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 실제 Prisma 클라이언트를 만들지 않는다 (운영 DB 접근 금지)
vi.mock("@/lib/db", () => ({ prisma: {} }));
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { processUpload } from "@/lib/excel/upload";

type Batch = { id: string; kind: string; fileName: string; fileHash: string; uploadedAt: Date; stockAsOf: Date | null; defectApplied: boolean };
type Snap = { productCode: string; qtyBox: number; batchId: string; stockAsOf: Date | null; uploadedAt: Date };

function makeFakeDb() {
  // 제품 마스터에 있는 품번만 재고 파일에서 받아들인다 (없으면 "품번 불일치")
  const state = { batches: [] as Batch[], snapshots: [] as Snap[], products: new Set<string>(["TM00329", "EM00001"]) };
  let seq = 0;
  const client = (s: typeof state) => ({
    uploadBatch: {
      findUnique: async ({ where }: { where: { fileHash: string } }) => s.batches.find((b) => b.fileHash === where.fileHash) ?? null,
      create: async ({ data }: { data: Omit<Batch, "id"> & { rowCount: number; uploadedBy: string } }) => {
        const b = { id: `b${++seq}`, ...data };
        s.batches.push(b);
        return b;
      },
    },
    product: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) =>
        where.code.in.filter((c) => s.products.has(c)).map((code) => ({ code })),
      createMany: async ({ data }: { data: { code: string }[] }) => {
        data.forEach((d) => s.products.add(d.code));
        return { count: data.length };
      },
    },
    stockSnapshot: {
      createMany: async ({ data }: { data: Snap[] }) => {
        s.snapshots.push(...data);
        return { count: data.length };
      },
    },
  });
  const db = {
    ...client(state),
    // 트랜잭션: 복사본에서 실행, 성공하면 반영, 실패하면 버림
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const draft = { batches: [...state.batches], snapshots: [...state.snapshots], products: new Set(state.products) };
      const result = await fn(client(draft));
      state.batches = draft.batches;
      state.snapshots = draft.snapshots;
      state.products = draft.products;
      return result;
    },
  };
  return { db: db as unknown as PrismaClient, state };
}

const cp949 = (text: string) => new Uint8Array(iconv.encode(text, "cp949"));
const GOOD = "품번\t품명/규격\t재고수량(박스)\r\nTM00329\t지평 1.7L\t120\r\nEM00001\tCJ 식용유\t0\r\n";
const BAD_COLUMNS = "품번\t품명\r\nTM00329\t지평 1.7L\r\n";
// 3행 수량 오류(숫자 아님), 4행 품번 불일치, 5행 수량 누락
const ROW_ERROR =
  "품번\t품명/규격\t재고수량\r\nTM00329\t지평 1.7L\t130\r\nEM00001\tCJ 식용유\tabc\r\nZZ9999\t없는 품번\t5\r\nTM00329\t지평 1.7L\t\r\n";

describe("잘못된 재고 파일 → 직전 기준 유지", () => {
  let fake: ReturnType<typeof makeFakeDb>;
  const asOf = new Date("2026-11-03T00:00:00+09:00");

  beforeEach(async () => {
    fake = makeFakeDb();
    const r = await processUpload("STOCK", "good.xls", cp949(GOOD), "t", { stockAsOf: asOf, defectApplied: true }, fake.db);
    expect(r.status).toBe("saved");
  });

  it("정상 파일은 배치·스냅샷·집계 시각·불량 반영 여부를 저장한다", () => {
    expect(fake.state.batches).toHaveLength(1);
    expect(fake.state.batches[0].stockAsOf).toEqual(asOf);
    expect(fake.state.batches[0].defectApplied).toBe(true);
    expect(fake.state.snapshots.map((s) => [s.productCode, s.qtyBox])).toEqual([
      ["TM00329", 120],
      ["EM00001", 0], // 파일에 0 → 0박스 (확인 필요 아님)
    ]);
    expect(fake.state.snapshots[0].stockAsOf).toEqual(asOf);
  });

  it("필수 컬럼이 없으면 아무것도 저장하지 않는다", async () => {
    const r = await processUpload("STOCK", "bad.xls", cp949(BAD_COLUMNS), "t", {}, fake.db);
    expect(r.status).toBe("mapping-error");
    expect(fake.state.batches).toHaveLength(1);
    expect(fake.state.batches[0].fileName).toBe("good.xls");
    expect(fake.state.snapshots).toHaveLength(2);
  });

  it("행 오류가 있으면 확인 전에는 저장하지 않고 오류 목록을 돌려준다", async () => {
    const r = await processUpload("STOCK", "rowerr.xls", cp949(ROW_ERROR), "t", {}, fake.db);
    expect(r.status).toBe("row-errors");
    if (r.status !== "row-errors") return;
    expect(r.errorCount).toBe(3);
    expect(r.validRows).toBe(1);
    expect(r.errors.map((e) => [e.row, e.kind])).toEqual([
      [3, "QTY"], // 숫자 아님
      [4, "CODE"], // 품번 불일치
      [5, "QTY"], // 수량 누락
    ]);
    expect(fake.state.batches).toHaveLength(1); // 직전 기준 유지
    expect(fake.state.snapshots.find((s) => s.productCode === "TM00329")?.qtyBox).toBe(120);
  });

  it("확인(allowRowErrors) 후에는 정상 행만 저장하고 오류 품목은 스냅샷에서 빠진다(→ 확인 필요)", async () => {
    const r = await processUpload("STOCK", "rowerr.xls", cp949(ROW_ERROR), "t", { allowRowErrors: true }, fake.db);
    expect(r.status).toBe("saved");
    if (r.status !== "saved") return;
    expect(r.result.errors).toHaveLength(3);
    const latest = fake.state.batches[1];
    const snaps = fake.state.snapshots.filter((s) => s.batchId === latest.id);
    expect(snaps.map((s) => s.productCode)).toEqual(["TM00329"]);
    expect(snaps[0].qtyBox).toBe(130);
  });

  it("같은 파일은 다시 저장하지 않는다", async () => {
    const r = await processUpload("STOCK", "good-again.xls", cp949(GOOD), "t", {}, fake.db);
    expect(r.status).toBe("duplicate");
    expect(fake.state.batches).toHaveLength(1);
  });
});
