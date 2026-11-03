/**
 * 시연·쓰기 e2e용 분리 스키마 준비. 운영 데이터가 있는 public 스키마는 절대 건드리지 않는다.
 *   DATABASE_SCHEMA=demo npx tsx scripts/demo-schema.ts
 * 1) DIRECT_URL?schema=<스키마>로 마이그레이션 적용  2) 그 스키마의 모든 행 삭제  3) 시연용 품목·거래처·출고실적만 넣기
 * 재고 파일(기초재고)은 넣지 않는다 — 시연(e2e/demo-scenario.spec.ts)이 화면에서 업로드한다.
 * 앱을 같은 DATABASE_SCHEMA로 띄우면(lib/db.ts) 이 스키마만 읽고 쓴다. 회사 실재고가 아닌 **샘플 시나리오** 자료다.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { createPrisma } from "../lib/db";
import { rebuildMonthlyStat } from "../lib/analytics/monthlyStat";

const DEMO_PRODUCTS = [
  { code: "DEMO-A", name: "시연용 PET 2L", capacity: "2L", packUnit: "박스", unitsPerBox: 100 }, // 개↔박스 환산
  { code: "DEMO-B", name: "시연용 PE 1L", capacity: "1L", packUnit: "박스", unitsPerBox: 50 },
  { code: "DEMO-E", name: "시연용 낱개 캡", capacity: null, packUnit: "없음", unitsPerBox: 1 }, // 박스 입수 없음 → 개 단위만 (120 → 불량 30 → 90)
  { code: "DEMO-Z", name: "시연용 재고0 용기", capacity: null, packUnit: "박스", unitsPerBox: 20 }, // 재고 파일에 0
  { code: "DEMO-U", name: "시연용 미확인 용기", capacity: null, packUnit: "박스", unitsPerBox: 20 }, // 재고 파일에 없음 → 확인 필요
];
export const DEMO_CUSTOMER = { code: "시연거래처", name: "시연거래처" };
const DEMO_COMPLETE_THROUGH = "2025-12";

async function main() {
  const schema = process.env.DATABASE_SCHEMA;
  if (!schema || schema === "public" || !/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error("DATABASE_SCHEMA에 public이 아닌 분리 스키마 이름을 지정하세요 (예: demo).");
  }
  const direct = process.env.DIRECT_URL;
  if (!direct) throw new Error("DIRECT_URL이 없습니다.");
  const url = `${direct}${direct.includes("?") ? "&" : "?"}schema=${schema}`;
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DIRECT_URL: url } });

  const db = createPrisma();
  // 자식 → 부모 순서로 비운다 (이 스키마만 — createPrisma가 DATABASE_SCHEMA를 쓴다)
  await db.stockAdjustment.updateMany({ data: { orderId: null, correctsId: null } });
  await db.stockAdjustment.deleteMany();
  await db.stockSnapshot.deleteMany();
  await db.shipmentHistory.deleteMany();
  await db.productionHistory.deleteMany();
  await db.monthlyStat.deleteMany();
  await db.uploadBatch.deleteMany();
  await db.customer.deleteMany();
  await db.product.deleteMany();
  await db.product.createMany({ data: DEMO_PRODUCTS });
  await db.customer.create({ data: { ...DEMO_CUSTOMER, type: "B2B" } });

  // 시연 거래처의 정상 출고(2025-01 ~ 2025-12) + 그 출고실적 배치의 집계 완료 월 2025-12
  const batch = await db.uploadBatch.create({
    data: { id: "demo-sales", kind: "SALES", fileName: "시연_출고실적.csv", fileHash: "demo-sales", rowCount: 0, uploadedBy: "시연", completeThrough: DEMO_COMPLETE_THROUGH, completeThroughSetAt: new Date() },
  });
  const ships: { productCode: string; date: Date; yearMonth: string; customerCode: string; slipNo: string; shipType: string; salesType: string; qtyUnits: number; qtyBox: number; batchId: string }[] = [];
  const plan: [string, number, number][] = [
    ["DEMO-E", 12, 40], // 품번, 출고 횟수(달마다 1회, 최근 N개 달), 1회 낱개
    ["DEMO-A", 8, 1000],
    ["DEMO-Z", 4, 200],
    ["DEMO-U", 3, 100],
  ];
  let slip = 0;
  for (const [code, months, units] of plan) {
    const per = DEMO_PRODUCTS.find((p) => p.code === code)!.unitsPerBox;
    for (let i = 0; i < months; i++) {
      const m = 12 - i;
      const ym = `2025-${String(m).padStart(2, "0")}`;
      ships.push({ productCode: code, date: new Date(`${ym}-15T00:00:00Z`), yearMonth: ym, customerCode: DEMO_CUSTOMER.code, slipNo: `D${++slip}`, shipType: "정상", salesType: "내수", qtyUnits: units, qtyBox: units / per, batchId: batch.id });
    }
  }
  await db.shipmentHistory.createMany({ data: ships });
  await db.uploadBatch.update({ where: { id: batch.id }, data: { rowCount: ships.length } });
  await rebuildMonthlyStat(db);
  console.log(`스키마 ${schema} 초기화 완료 — 품목 ${DEMO_PRODUCTS.length}개, 거래처 ${DEMO_CUSTOMER.name}, 출고 ${ships.length}행 (샘플 시나리오)`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
