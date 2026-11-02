/**
 * 생산실적 전체 재입력: ProductionHistory를 비우고 docs/data/clean/production_2021_2025.csv를
 * 작업지시번호(workOrderNo) 포함으로 다시 넣은 뒤 MonthlyStat을 재계산한다.
 *   npx tsx scripts/reimport-production.ts
 * (2026-11-03: workOrderNo 컬럼 추가 전에 들어간 행을 교체하기 위해 1회 실행)
 */
import "dotenv/config";
import fs from "node:fs";
import { parseCsvText } from "../lib/excel/csv";
import { importProduction } from "../lib/excel/import";
import { rebuildMonthlyStat } from "../lib/analytics/monthlyStat";
import { createPrisma } from "../lib/db";

const p = createPrisma();
(async () => {
  const t0 = Date.now();
  let text = fs.readFileSync("docs/data/clean/production_2021_2025.csv", "utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = parseCsvText(text).map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  console.log("before", await p.productionHistory.count());
  const del = await p.productionHistory.deleteMany({});
  console.log("deleted", del.count);
  const r = await p.$transaction((tx) => importProduction(tx as typeof p, rows, {}), { timeout: 600_000, maxWait: 10_000 });
  console.log(r.ok ? { inserted: r.inserted, duplicates: r.duplicates, skipped: r.skipped } : r);
  console.log("monthly", await rebuildMonthlyStat(p));
  console.log("after", await p.productionHistory.count(), "null workOrderNo", await p.productionHistory.count({ where: { workOrderNo: null } }), ((Date.now() - t0) / 1000).toFixed(0) + "s");
  await p.$disconnect();
})();
