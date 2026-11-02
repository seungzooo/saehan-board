-- CreateTable
CREATE TABLE "Product" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "itemType" TEXT,
    "capacity" TEXT,
    "packUnit" TEXT NOT NULL DEFAULT '박스',
    "unitsPerBox" INTEGER NOT NULL DEFAULT 1,
    "category" TEXT,
    "isProduced" BOOLEAN NOT NULL DEFAULT false,
    "boxW" INTEGER,
    "boxD" INTEGER,
    "boxH" INTEGER,
    "volumeM3" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" SERIAL NOT NULL,
    "productCode" TEXT NOT NULL,
    "qtyBox" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" SERIAL NOT NULL,
    "productCode" TEXT NOT NULL,
    "qtyBox" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "memo" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionHistory" (
    "id" SERIAL NOT NULL,
    "productCode" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "dept" TEXT,
    "shift" TEXT,
    "machine" TEXT,
    "slipType" TEXT NOT NULL,
    "unitsPerBox" INTEGER,
    "qtyGood" INTEGER NOT NULL,
    "qtyDefect" INTEGER NOT NULL,
    "batchId" TEXT,

    CONSTRAINT "ProductionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentHistory" (
    "id" SERIAL NOT NULL,
    "productCode" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "slipNo" TEXT,
    "shipType" TEXT NOT NULL,
    "salesType" TEXT NOT NULL,
    "qtyUnits" INTEGER NOT NULL,
    "qtyBox" DOUBLE PRECISION NOT NULL,
    "batchId" TEXT,

    CONSTRAINT "ShipmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'B2C',
    "typeSource" TEXT NOT NULL DEFAULT 'AUTO',
    "orderUnit" TEXT NOT NULL DEFAULT 'BOX',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "tonnage" DOUBLE PRECISION NOT NULL,
    "capacityM3" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalIndex" (
    "yearMonth" TEXT NOT NULL,
    "kosisShipmentIndex" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ExternalIndex_pkey" PRIMARY KEY ("yearMonth")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyStat" (
    "id" SERIAL NOT NULL,
    "productCode" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "qtyProduced" INTEGER NOT NULL DEFAULT 0,
    "qtyProdDefect" INTEGER NOT NULL DEFAULT 0,
    "qtyShippedBox" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qtyShippedB2B" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qtyShippedB2C" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "MonthlyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadBatch_fileHash_key" ON "UploadBatch"("fileHash");

-- CreateIndex
CREATE INDEX "StockSnapshot_productCode_uploadedAt_idx" ON "StockSnapshot"("productCode", "uploadedAt");

-- CreateIndex
CREATE INDEX "StockSnapshot_batchId_idx" ON "StockSnapshot"("batchId");

-- CreateIndex
CREATE INDEX "StockAdjustment_productCode_createdAt_idx" ON "StockAdjustment"("productCode", "createdAt");

-- CreateIndex
CREATE INDEX "ProductionHistory_productCode_date_idx" ON "ProductionHistory"("productCode", "date");

-- CreateIndex
CREATE INDEX "ProductionHistory_date_idx" ON "ProductionHistory"("date");

-- CreateIndex
CREATE INDEX "ProductionHistory_yearMonth_idx" ON "ProductionHistory"("yearMonth");

-- CreateIndex
CREATE INDEX "ShipmentHistory_productCode_date_idx" ON "ShipmentHistory"("productCode", "date");

-- CreateIndex
CREATE INDEX "ShipmentHistory_customerCode_date_idx" ON "ShipmentHistory"("customerCode", "date");

-- CreateIndex
CREATE INDEX "ShipmentHistory_date_idx" ON "ShipmentHistory"("date");

-- CreateIndex
CREATE INDEX "ShipmentHistory_yearMonth_idx" ON "ShipmentHistory"("yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE INDEX "MonthlyStat_yearMonth_idx" ON "MonthlyStat"("yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyStat_productCode_yearMonth_key" ON "MonthlyStat"("productCode", "yearMonth");

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSnapshot" ADD CONSTRAINT "StockSnapshot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionHistory" ADD CONSTRAINT "ProductionHistory_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionHistory" ADD CONSTRAINT "ProductionHistory_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentHistory" ADD CONSTRAINT "ShipmentHistory_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentHistory" ADD CONSTRAINT "ShipmentHistory_customerCode_fkey" FOREIGN KEY ("customerCode") REFERENCES "Customer"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentHistory" ADD CONSTRAINT "ShipmentHistory_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyStat" ADD CONSTRAINT "MonthlyStat_productCode_fkey" FOREIGN KEY ("productCode") REFERENCES "Product"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
