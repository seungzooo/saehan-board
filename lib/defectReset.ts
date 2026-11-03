import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * 품목별 불량 차감 리셋 시점: 그 품목이 **파일에 실제로 들어 있던**(이월 아님) "사후 불량 반영됨"(defectApplied) 재고 배치 중
 * 가장 늦은 기준 시각(집계 시각, 없으면 반영 시각). 없으면 그 품목의 불량은 전부 누적.
 * 일부 갱신 파일에 없던 품목은 그 파일의 "불량 반영됨"으로 리셋되지 않는다.
 */
export async function defectResetAtFor(db: PrismaClient, codes: string[]): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (codes.length === 0) return map;
  const rows = await db.stockSnapshot.findMany({
    where: { productCode: { in: codes }, carried: false, batch: { kind: "STOCK", defectApplied: true, revertedAt: null } },
    select: { productCode: true, stockAsOf: true, uploadedAt: true },
  });
  for (const r of rows) {
    const at = r.stockAsOf ?? r.uploadedAt;
    const cur = map.get(r.productCode);
    if (!cur || at > cur) map.set(r.productCode, at);
  }
  return map;
}
