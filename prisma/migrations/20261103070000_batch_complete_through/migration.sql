-- 업로드 배치마다 "집계 완료 월"을 저장 (출고실적·생산실적). 앱은 가장 최근 배치의 값을 쓴다.
ALTER TABLE "UploadBatch" ADD COLUMN "completeThrough" TEXT;
ALTER TABLE "UploadBatch" ADD COLUMN "completeThroughSetAt" TIMESTAMP(3);

-- 기존 2021~2025 데이터: seed로 넣은 정리본은 배치가 없으므로 출처를 남기는 배치를 하나씩 만든다.
-- 근거: 원본이 연간 보고서(2021~2025년 판매실적·생산실적 .xls, 각 01-01~12-31)
INSERT INTO "UploadBatch" ("id", "kind", "fileName", "fileHash", "rowCount", "uploadedAt", "uploadedBy", "stockAsOf", "defectApplied", "mode", "completeThrough", "completeThroughSetAt")
SELECT 'seed-sales-2021-2025', 'SALES', '기존 정리본 2021~2025년 판매실적 (연간 보고서 5개)', 'seed-sales-2021-2025',
       (SELECT count(*) FROM "ShipmentHistory"), TIMESTAMP '2025-12-31 15:00:00', 'seed', NULL, false, 'REPLACE', '2025-12', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "UploadBatch" WHERE "fileHash" = 'seed-sales-2021-2025');

INSERT INTO "UploadBatch" ("id", "kind", "fileName", "fileHash", "rowCount", "uploadedAt", "uploadedBy", "stockAsOf", "defectApplied", "mode", "completeThrough", "completeThroughSetAt")
SELECT 'seed-production-2021-2025', 'PRODUCTION', '기존 정리본 2021~2025년 생산실적 (연간 보고서 15개)', 'seed-production-2021-2025',
       (SELECT count(*) FROM "ProductionHistory"), TIMESTAMP '2025-12-31 15:00:00', 'seed', NULL, false, 'REPLACE', '2025-12', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "UploadBatch" WHERE "fileHash" = 'seed-production-2021-2025');

-- 이미 올라온 출고·생산실적 배치도 2021~2025 범위이므로 2025-12
UPDATE "UploadBatch" SET "completeThrough" = '2025-12', "completeThroughSetAt" = CURRENT_TIMESTAMP
WHERE "kind" IN ('SALES', 'PRODUCTION') AND "completeThrough" IS NULL;
