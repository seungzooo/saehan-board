-- 출고 변동 탐지 결과·메모·실행 기록
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "customerCode" TEXT,
    "productCode" TEXT,
    "grain" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "actual" DOUBLE PRECISION NOT NULL,
    "baseline" DOUBLE PRECISION NOT NULL,
    "diff" DOUBLE PRECISION NOT NULL,
    "impact" DOUBLE PRECISION NOT NULL,
    "groupImpact" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShipmentEvent_groupKey_idx" ON "ShipmentEvent"("groupKey");
CREATE INDEX "ShipmentEvent_customerCode_idx" ON "ShipmentEvent"("customerCode");
CREATE INDEX "ShipmentEvent_productCode_idx" ON "ShipmentEvent"("productCode");
CREATE INDEX "ShipmentEvent_periodEnd_idx" ON "ShipmentEvent"("periodEnd");

CREATE TABLE "ShipmentEventNote" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShipmentEventNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShipmentEventNote_eventId_idx" ON "ShipmentEventNote"("eventId");

CREATE TABLE "ShipmentEventRun" (
    "id" SERIAL NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completeThrough" TEXT,
    "firstMonth" TEXT,
    "events" INTEGER NOT NULL,
    "groups" INTEGER NOT NULL,
    "materiality" DOUBLE PRECISION NOT NULL,
    "missingMonths" TEXT NOT NULL,
    CONSTRAINT "ShipmentEventRun_pkey" PRIMARY KEY ("id")
);
