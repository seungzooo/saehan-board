-- 재고 업로드: 집계 기준 시각(stockAsOf)과 사후 불량 반영 여부(defectApplied)
ALTER TABLE "UploadBatch" ADD COLUMN "stockAsOf" TIMESTAMP(3);
ALTER TABLE "UploadBatch" ADD COLUMN "defectApplied" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockSnapshot" ADD COLUMN "stockAsOf" TIMESTAMP(3);

-- F8(로그인·권한) 삭제: 모든 화면 누구나 접근
DROP TABLE "User";
