/**
 * 출고 변동 탐지 결과를 다시 계산해 저장 (처음 한 번 또는 앱 밖에서 실적을 바꾼 뒤).
 *   npx tsx scripts/rebuild-events.ts            (DATABASE_SCHEMA가 있으면 그 스키마)
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { rebuildShipmentEvents } from "../lib/events/rebuild";

(async () => {
  const r = await rebuildShipmentEvents(prisma);
  console.log(`탐지 ${r.events}건 · 묶음 ${r.groups}건 · ${r.ms}ms`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
