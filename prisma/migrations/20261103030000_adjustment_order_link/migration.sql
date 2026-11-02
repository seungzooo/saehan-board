-- 출고(SHIPMENT)가 어느 수주(ORDER)를 이행했는지 — 이중 차감 방지
ALTER TABLE "StockAdjustment" ADD COLUMN "orderId" INTEGER;
CREATE INDEX "StockAdjustment_orderId_idx" ON "StockAdjustment"("orderId");
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "StockAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
