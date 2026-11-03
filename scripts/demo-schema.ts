/**
 * 시연·쓰기 e2e용 분리 스키마 준비. 운영 데이터가 있는 public 스키마는 절대 건드리지 않는다.
 *   DATABASE_SCHEMA=demo npx tsx scripts/demo-schema.ts
 * 1) DIRECT_URL?schema=<스키마>로 마이그레이션 적용  2) 그 스키마의 모든 행 삭제  3) 시연용 품목 2개만 넣기
 * 앱을 같은 DATABASE_SCHEMA로 띄우면(lib/db.ts) 이 스키마만 읽고 쓴다.
 */
import "dotenv/config";
import { execSync } from "node:child_process";
import { createPrisma } from "../lib/db";

const DEMO_PRODUCTS = [
  { code: "DEMO-A", name: "시연용 PET 2L", capacity: "2L", packUnit: "박스", unitsPerBox: 100 },
  { code: "DEMO-B", name: "시연용 PE 1L", capacity: "1L", packUnit: "박스", unitsPerBox: 50 },
];

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
  console.log(`스키마 ${schema} 초기화 완료 — 품목 ${DEMO_PRODUCTS.map((p) => p.code).join(", ")}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
