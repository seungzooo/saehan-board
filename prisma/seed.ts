/**
 * seed: 더미를 만들지 않고 docs/data/clean/의 정리본 CSV를 import한다.
 *   npx prisma db seed   (또는 npx tsx prisma/seed.ts)
 *
 * 1. sales_2021_2025.csv      → ShipmentHistory + Product + Customer
 * 2. production_2021_2025.csv → ProductionHistory (+ Product.isProduced)
 *    두 실적 모두 중복 키(@@unique)가 같은 행은 건너뛰므로 seed를 여러 번 실행해도 안전하다.
 * 3. MonthlyStat 재계산
 * 4. 개발용 기초재고: 교집합(isProduced) 품번에 대해 최근 30일 출고 박스 × 1.5
 *    (재고 엑셀 샘플을 받으면 F1 업로드로 교체)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parseCsvText } from "../lib/excel/csv";
import { importProduction, importSales } from "../lib/excel/import";
import { rebuildMonthlyStat } from "../lib/analytics/monthlyStat";
import { createPrisma } from "../lib/db";

const CLEAN_DIR = path.join(process.cwd(), "docs", "data", "clean");
const SALES_CSV = path.join(CLEAN_DIR, "sales_2021_2025.csv");
const PROD_CSV = path.join(CLEAN_DIR, "production_2021_2025.csv");
export const DEV_STOCK_BATCH_ID = "seed-dev-stock";
const TX = { timeout: 600_000, maxWait: 10_000 };

function readCsv(file: string): string[][] {
  let text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parseCsvText(text)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

async function main() {
  const prisma = createPrisma();
  const t0 = Date.now();
  const log = (msg: string) => console.log(`[seed +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  for (const f of [SALES_CSV, PROD_CSV]) {
    if (!fs.existsSync(f)) {
      console.error(`정리본이 없습니다: ${f}\n  → npx tsx scripts/clean-data.ts 로 먼저 생성하세요.`);
      process.exit(1);
    }
  }

  // 1. 판매실적
  const sales = readCsv(SALES_CSV);
  log(`판매실적 CSV ${sales.length - 1}행 읽음`);
  const sr = await prisma.$transaction((tx) => importSales(tx as typeof prisma, sales, {}), TX);
  if (!sr.ok) throw new Error(`판매실적 컬럼 누락: ${sr.missing.join(", ")}`);
  log(`ShipmentHistory ${sr.inserted}행, 신규 품목 ${sr.newProducts}, 신규 거래처 ${sr.newCustomers}, 건너뜀 ${sr.skipped}`);
  if (sr.errors.length) console.warn("  오류 예시:", sr.errors.slice(0, 5));

  // 2. 생산실적
  const prod = readCsv(PROD_CSV);
  log(`생산실적 CSV ${prod.length - 1}행 읽음`);
  const pr = await prisma.$transaction((tx) => importProduction(tx as typeof prisma, prod, {}), TX);
  if (!pr.ok) throw new Error(`생산실적 컬럼 누락: ${pr.missing.join(", ")}`);
  log(`ProductionHistory ${pr.inserted}행, 신규 품목 ${pr.newProducts}, 건너뜀 ${pr.skipped}`);
  if (pr.errors.length) console.warn("  오류 예시:", pr.errors.slice(0, 5));

  // 3. 월별 집계
  const n = await rebuildMonthlyStat(prisma);
  log(`MonthlyStat ${n}행`);

  // 4. 개발용 기초재고
  const last = await prisma.shipmentHistory.aggregate({ _max: { date: true } });
  const to = last._max.date;
  if (to) {
    const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    const recent = await prisma.shipmentHistory.groupBy({
      by: ["productCode"],
      where: { date: { gt: from, lte: to }, shipType: "정상", salesType: "내수" },
      _sum: { qtyBox: true },
    });
    const produced = new Set(
      (await prisma.product.findMany({ where: { isProduced: true }, select: { code: true } })).map((p) => p.code),
    );
    const uploadedAt = new Date();
    await prisma.stockSnapshot.deleteMany({ where: { batchId: DEV_STOCK_BATCH_ID } });
    await prisma.uploadBatch.deleteMany({ where: { id: DEV_STOCK_BATCH_ID } });
    const data = recent
      .filter((r) => produced.has(r.productCode) && (r._sum.qtyBox ?? 0) > 0)
      .map((r) => ({
        productCode: r.productCode,
        qtyBox: Math.round((r._sum.qtyBox ?? 0) * 1.5),
        uploadedAt,
        uploadedBy: "seed",
        batchId: DEV_STOCK_BATCH_ID,
      }));
    await prisma.uploadBatch.create({
      data: {
        id: DEV_STOCK_BATCH_ID,
        kind: "STOCK",
        fileName: `(개발용) 최근 30일 출고 × 1.5, 기준 ${to.toISOString().slice(0, 10)}`,
        fileHash: DEV_STOCK_BATCH_ID,
        rowCount: data.length,
        uploadedAt,
        uploadedBy: "seed",
      },
    });
    for (let i = 0; i < data.length; i += 500) await prisma.stockSnapshot.createMany({ data: data.slice(i, i + 500) });
    log(`개발용 기초재고 ${data.length}품목 (출고 기준일 ${to.toISOString().slice(0, 10)})`);
  }

  await prisma.$disconnect();
  log("완료");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
