-- 일부 갱신(MERGE)으로 이월된 재고 행 표시. 이월 행은 원래 품목의 집계·반영 시각을 유지한다
ALTER TABLE "StockSnapshot" ADD COLUMN "carried" BOOLEAN NOT NULL DEFAULT false;
