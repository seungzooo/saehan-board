-- 재고 업로드 모드(전체 교체 / 있는 품목만 갱신)와 복구
ALTER TABLE "UploadBatch" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'REPLACE';
ALTER TABLE "UploadBatch" ADD COLUMN "revertedAt" TIMESTAMP(3);

-- 변동 입력: 요청 ID 멱등, 정정 기록
ALTER TABLE "StockAdjustment" ADD COLUMN "requestId" TEXT;
ALTER TABLE "StockAdjustment" ADD COLUMN "correctsId" INTEGER;
ALTER TABLE "StockAdjustment" ADD COLUMN "correctionReason" TEXT;
CREATE UNIQUE INDEX "StockAdjustment_requestId_key" ON "StockAdjustment"("requestId");
CREATE INDEX "StockAdjustment_correctsId_idx" ON "StockAdjustment"("correctsId");
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_correctsId_fkey"
  FOREIGN KEY ("correctsId") REFERENCES "StockAdjustment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
