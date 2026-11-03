/** MonthlyStat 전체 재계산 (스키마에 집계 컬럼을 추가했을 때 1회 실행)  npx tsx scripts/rebuild-monthly.ts */
import "dotenv/config";
import { rebuildMonthlyStat } from "../lib/analytics/monthlyStat";
import { createPrisma } from "../lib/db";
const p = createPrisma();
(async () => {
  const t0 = Date.now();
  console.log("MonthlyStat", await rebuildMonthlyStat(p), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await p.$disconnect();
})();
