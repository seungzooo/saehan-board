-- 생산량 박스 환산 (출고와 같은 단위로 비교)
ALTER TABLE "MonthlyStat" ADD COLUMN "qtyProducedBox" DOUBLE PRECISION NOT NULL DEFAULT 0;
