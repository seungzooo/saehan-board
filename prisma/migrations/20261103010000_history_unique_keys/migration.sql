-- 생산실적: 작업지시번호 컬럼 추가 + 중복 키
ALTER TABLE "ProductionHistory" ADD COLUMN "workOrderNo" TEXT;
CREATE UNIQUE INDEX "ProductionHistory_date_productCode_workOrderNo_shift_machin_key"
  ON "ProductionHistory"("date", "productCode", "workOrderNo", "shift", "machine", "slipType");

-- 출고실적: 중복 키
CREATE UNIQUE INDEX "ShipmentHistory_date_productCode_slipNo_key"
  ON "ShipmentHistory"("date", "productCode", "slipNo");
