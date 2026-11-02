/**
 * 매핑된 행 → DB 저장. seed(CSV 정리본)와 F1 업로드가 같은 함수를 쓴다.
 *
 * 저장 규칙
 * - STOCK: batch 1개 + 전 품목 StockSnapshot. 같은 품번이 여러 행이면 합산(창고별 행 가정).
 * - SALES / PRODUCTION: 중복 키(스키마 @@unique)가 같은 행은 건너뛰고 새 행만 넣는다.
 *   같은 기간을 다시 내려받아 올려도 두 번 저장되지 않는다 (createMany skipDuplicates).
 *   ERP에서 수정된 행(수량이 바뀐 같은 전표)은 갱신되지 않는다 — 그 경우는 관리자가 기간 삭제 후 재업로드.
 * - PRODUCT / CUSTOMER: upsert.
 */
import {
  B2B_MIN_SHIPMENT_COUNT,
  CATEGORY_BY_PREFIX,
  CUSTOMER_MAPPING,
  PRODUCTION_MAPPING,
  PRODUCT_MAPPING,
  SALES_MAPPING,
  STOCK_MAPPING,
} from "@/config/excel-mapping";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { applyMapping, productPrefix, slipTypeCode, toIsoDate, toNumber } from "./mapping";

type Db = PrismaClient;
const CHUNK = 500;

export type RowErrorKind = "CODE" | "QTY" | "OTHER"; // 품번 불일치 / 수량 누락·오류 / 기타
export type RowError = { row: number; message: string; kind: RowErrorKind; code?: string };
export type ImportResult = {
  ok: true;
  inserted: number;
  skipped: number;
  errors: RowError[]; // 전체 보관 (화면은 앞 20건만 표시)
  newProducts: number;
  newCustomers: number;
  updated?: number; // 마스터 업로드: 기존 행 갱신 수 / 재고: 기존 품목 수
  duplicates?: number; // 실적 업로드: 이미 있어 건너뛴 행
  period?: { from: string; to: string };
  note?: string;
};
export type ImportFailure = { ok: false; missing: string[]; headerFound: string[] };
export type ImportOutcome = ImportResult | ImportFailure;

type ProductSeed = { name: string; itemType?: string; capacity?: string; packUnit?: string; unitsPerBox?: number };

function pushErr(errs: RowError[], row: number, message: string, kind: RowErrorKind = "OTHER", code?: string) {
  errs.push({ row, message, kind, code });
}

async function chunked<T>(items: T[], fn: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += CHUNK) await fn(items.slice(i, i + CHUNK));
}

function categoryOf(code: string): string | null {
  return CATEGORY_BY_PREFIX[productPrefix(code)] ?? null;
}

function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateFromIso(iso: string): Date {
  // 로컬 시간대와 무관하게 UTC 자정으로 고정 — 조회/비교 시 일관성 유지
  return new Date(iso + "T00:00:00.000Z");
}

/** 존재하지 않는 품번을 Product에 생성. 이미 있으면 갱신하지 않는다 */
async function ensureProducts(db: Db, items: Map<string, ProductSeed>): Promise<number> {
  const codes = [...items.keys()];
  const existing = new Set<string>();
  await chunked(codes, async (c) => {
    const found = await db.product.findMany({ where: { code: { in: c } }, select: { code: true } });
    found.forEach((p) => existing.add(p.code));
  });
  const toCreate = codes
    .filter((c) => !existing.has(c))
    .map((code) => {
      const it = items.get(code)!;
      return {
        code,
        name: it.name || code,
        itemType: it.itemType || null,
        capacity: it.capacity || null,
        packUnit: it.packUnit || "박스",
        unitsPerBox: it.unitsPerBox && it.unitsPerBox > 0 ? Math.round(it.unitsPerBox) : 1,
        category: categoryOf(code),
      };
    });
  await chunked(toCreate, (c) => db.product.createMany({ data: c }));
  return toCreate.length;
}

async function ensureCustomers(db: Db, names: Set<string>): Promise<number> {
  const codes = [...names];
  const existing = new Set<string>();
  await chunked(codes, async (c) => {
    const found = await db.customer.findMany({ where: { code: { in: c } }, select: { code: true } });
    found.forEach((p) => existing.add(p.code));
  });
  const toCreate = codes.filter((c) => !existing.has(c)).map((code) => ({ code, name: code }));
  await chunked(toCreate, (c) => db.customer.createMany({ data: c }));
  return toCreate.length;
}

// ───────────────────────── STOCK ─────────────────────────

export async function importStock(
  db: Db,
  sheet: string[][],
  ctx: { batchId: string; uploadedBy: string; uploadedAt: Date; stockAsOf: Date | null },
): Promise<ImportOutcome> {
  const mapped = applyMapping(sheet, STOCK_MAPPING);
  if (!mapped.ok) return mapped;
  const errors: RowError[] = [];
  const qty = new Map<string, number>();
  let skipped = 0;
  // 재고 파일의 품번은 제품 마스터에 있어야 한다. 없으면 "품번 불일치"로 보고하고 저장하지 않는다
  // (판매·생산실적은 신규 품번을 자동 생성하지만, 재고는 오타를 걸러내는 쪽이 안전)
  const codesInFile = [...new Set(mapped.rows.map((r) => r.productCode).filter(Boolean))];
  const known = new Set<string>();
  await chunked(codesInFile, async (c) => {
    (await db.product.findMany({ where: { code: { in: c } }, select: { code: true } })).forEach((p) => known.add(p.code));
  });
  for (const r of mapped.rows) {
    const code = r.productCode;
    if (!code) {
      skipped++;
      continue;
    }
    if (!known.has(code)) {
      pushErr(errors, r.__row, `품번 불일치: "${code}" 이(가) 제품 마스터에 없음`, "CODE", code);
      skipped++;
      continue;
    }
    if (r.qtyBox === "") {
      pushErr(errors, r.__row, `수량 누락: ${code}`, "QTY", code);
      skipped++;
      continue;
    }
    const n = toNumber(r.qtyBox);
    if (Number.isNaN(n)) {
      pushErr(errors, r.__row, `수량 오류: ${code} 재고수량이 숫자가 아님 "${r.qtyBox}"`, "QTY", code);
      skipped++;
      continue;
    }
    qty.set(code, (qty.get(code) ?? 0) + n);
  }
  const newProducts = 0;
  const data = [...qty.entries()].map(([productCode, q]) => ({
    productCode,
    qtyBox: Math.round(q),
    uploadedAt: ctx.uploadedAt,
    stockAsOf: ctx.stockAsOf,
    uploadedBy: ctx.uploadedBy,
    batchId: ctx.batchId,
  }));
  await chunked(data, (c) => db.stockSnapshot.createMany({ data: c }));
  return {
    ok: true,
    inserted: data.length,
    skipped,
    errors,
    newProducts,
    newCustomers: 0,
    updated: data.length - newProducts,
    note: mapped.rows.length - skipped !== data.length ? "같은 품번 행은 합산했습니다." : undefined,
  };
}

// ───────────────────────── SALES ─────────────────────────

export async function importSales(db: Db, sheet: string[][], ctx: { batchId?: string }): Promise<ImportOutcome> {
  const mapped = applyMapping(sheet, SALES_MAPPING);
  if (!mapped.ok) return mapped;
  const errors: RowError[] = [];
  let skipped = 0;
  const products = new Map<string, ProductSeed>();
  const customers = new Set<string>();
  const rows: Array<{
    productCode: string;
    date: Date;
    yearMonth: string;
    customerCode: string;
    slipNo: string | null;
    shipType: string;
    salesType: string;
    qtyUnits: number;
    qtyBox: number;
    batchId: string | null;
  }> = [];
  for (const r of mapped.rows) {
    if (!r.productCode) {
      skipped++;
      continue;
    }
    const iso = toIsoDate(r.date);
    if (!iso) {
      pushErr(errors, r.__row, `출고일자 형식 오류: "${r.date}"`);
      skipped++;
      continue;
    }
    const units = toNumber(r.qtyUnits);
    const upb = toNumber(r.unitsPerBox);
    if (Number.isNaN(units) || Number.isNaN(upb)) {
      pushErr(errors, r.__row, `수량이 숫자가 아님: 출고수량 "${r.qtyUnits}", 포장단위수량 "${r.unitsPerBox}"`);
      skipped++;
      continue;
    }
    const customer = r.customerName || "(미상)";
    customers.add(customer);
    // 파일 순서상 뒤(최신) 행의 품명/포장 정보를 사용
    products.set(r.productCode, {
      name: r.productName,
      itemType: r.itemType,
      capacity: r.capacity,
      packUnit: r.packUnit,
      unitsPerBox: upb,
    });
    rows.push({
      productCode: r.productCode,
      date: dateFromIso(iso),
      yearMonth: iso.slice(0, 7),
      customerCode: customer,
      slipNo: r.slipNo || null,
      shipType: r.shipType || "정상",
      salesType: r.salesType || "내수",
      qtyUnits: Math.round(units),
      qtyBox: upb > 0 ? units / upb : units,
      batchId: ctx.batchId ?? null,
    });
  }
  if (rows.length === 0) return { ok: true, inserted: 0, skipped, errors, newProducts: 0, newCustomers: 0 };

  const newProducts = await ensureProducts(db, products);
  const newCustomers = await ensureCustomers(db, customers);
  const dates = rows.map((r) => r.date.getTime());
  const from = new Date(Math.min(...dates));
  const to = new Date(Math.max(...dates));
  let inserted = 0;
  await chunked(rows, async (c) => {
    const r = await db.shipmentHistory.createMany({ data: c, skipDuplicates: true });
    inserted += r.count;
  });
  const duplicates = rows.length - inserted;
  await refreshCustomerTypes(db);
  return {
    ok: true,
    inserted,
    skipped,
    errors,
    newProducts,
    newCustomers,
    duplicates,
    period: { from: isoOf(from), to: isoOf(to) },
    note: duplicates > 0 ? `이미 있는 ${duplicates.toLocaleString()}행(같은 출고일자·품번·전표번호)은 건너뛰었습니다.` : undefined,
  };
}

/** 분류표를 받기 전 기본값: 5년 출고 건수 100건 초과 = B2B. MANUAL 분류는 건드리지 않는다 */
export async function refreshCustomerTypes(db: Db) {
  const counts = await db.shipmentHistory.groupBy({ by: ["customerCode"], _count: { _all: true } });
  const auto = await db.customer.findMany({ where: { typeSource: "AUTO" }, select: { code: true, type: true } });
  const countMap = new Map(counts.map((c) => [c.customerCode, c._count._all]));
  for (const c of auto) {
    const type = (countMap.get(c.code) ?? 0) > B2B_MIN_SHIPMENT_COUNT ? "B2B" : "B2C";
    if (type !== c.type) await db.customer.update({ where: { code: c.code }, data: { type } });
  }
}

// ───────────────────────── PRODUCTION ─────────────────────────

export async function importProduction(db: Db, sheet: string[][], ctx: { batchId?: string }): Promise<ImportOutcome> {
  const mapped = applyMapping(sheet, PRODUCTION_MAPPING);
  if (!mapped.ok) return mapped;
  const errors: RowError[] = [];
  let skipped = 0;
  const products = new Map<string, ProductSeed>();
  const rows: Array<{
    productCode: string;
    date: Date;
    yearMonth: string;
    dept: string | null;
    shift: string | null;
    machine: string | null;
    workOrderNo: string | null;
    slipType: string;
    unitsPerBox: number | null;
    qtyGood: number;
    qtyDefect: number;
    batchId: string | null;
  }> = [];
  for (const r of mapped.rows) {
    if (!r.productCode) {
      skipped++;
      continue;
    }
    const iso = toIsoDate(r.date);
    if (!iso) {
      pushErr(errors, r.__row, `생산일자 형식 오류: "${r.date}"`);
      skipped++;
      continue;
    }
    const good = toNumber(r.qtyGood);
    const defect = toNumber(r.qtyDefect);
    if (Number.isNaN(good) || Number.isNaN(defect)) {
      pushErr(errors, r.__row, `수량이 숫자가 아님: A급 "${r.qtyGood}", C급 "${r.qtyDefect}"`);
      skipped++;
      continue;
    }
    const upb = toNumber(r.unitsPerBox);
    if (!products.has(r.productCode))
      products.set(r.productCode, { name: r.productName, itemType: r.itemType, packUnit: r.packUnit, unitsPerBox: upb });
    const dept = r.dept || null;
    rows.push({
      productCode: r.productCode,
      date: dateFromIso(iso),
      yearMonth: iso.slice(0, 7),
      dept,
      shift: r.shift ? r.shift.slice(0, 1) : null, // "A A조" → "A"
      machine: r.machine || null,
      workOrderNo: r.workOrderNo || null,
      slipType: slipTypeCode(r.slipType),
      unitsPerBox: Number.isNaN(upb) || upb <= 0 ? null : Math.round(upb),
      qtyGood: Math.round(good),
      qtyDefect: Math.round(defect),
      batchId: ctx.batchId ?? null,
    });
  }
  if (rows.length === 0) return { ok: true, inserted: 0, skipped, errors, newProducts: 0, newCustomers: 0 };

  const newProducts = await ensureProducts(db, products);
  const dates = rows.map((r) => r.date.getTime());
  const from = new Date(Math.min(...dates));
  const to = new Date(Math.max(...dates));
  let inserted = 0;
  await chunked(rows, async (c) => {
    const r = await db.productionHistory.createMany({ data: c, skipDuplicates: true });
    inserted += r.count;
  });
  const duplicates = rows.length - inserted;
  await chunked([...products.keys()], (c) =>
    db.product.updateMany({ where: { code: { in: c }, isProduced: false }, data: { isProduced: true } }),
  );
  return {
    ok: true,
    inserted,
    skipped,
    errors,
    newProducts,
    newCustomers: 0,
    duplicates,
    period: { from: isoOf(from), to: isoOf(to) },
    note:
      duplicates > 0
        ? `이미 있는 ${duplicates.toLocaleString()}행(같은 생산일자·품번·작업지시번호·조·호기·전표구분)은 건너뛰었습니다.`
        : undefined,
  };
}

// ───────────────────────── PRODUCT ─────────────────────────

export async function importProducts(db: Db, sheet: string[][]): Promise<ImportOutcome> {
  const mapped = applyMapping(sheet, PRODUCT_MAPPING);
  if (!mapped.ok) return mapped;
  const errors: RowError[] = [];
  let inserted = 0;
  let skipped = 0;
  let created = 0;
  const existing = new Set(
    (await db.product.findMany({ where: { code: { in: mapped.rows.map((r) => r.code).filter(Boolean) } }, select: { code: true } })).map((p) => p.code),
  );
  for (const r of mapped.rows) {
    if (!r.code) {
      skipped++;
      continue;
    }
    if (!existing.has(r.code)) created++;
    const nums = {
      unitsPerBox: toNumber(r.unitsPerBox),
      boxW: toNumber(r.boxW),
      boxD: toNumber(r.boxD),
      boxH: toNumber(r.boxH),
    };
    if (Object.values(nums).some(Number.isNaN)) {
      pushErr(errors, r.__row, "입수/규격이 숫자가 아님");
      skipped++;
      continue;
    }
    const hasBox = nums.boxW > 0 && nums.boxD > 0 && nums.boxH > 0;
    const dims = hasBox
      ? { boxW: nums.boxW, boxD: nums.boxD, boxH: nums.boxH, volumeM3: (nums.boxW * nums.boxD * nums.boxH) / 1e9 }
      : {};
    const unitsPerBox = nums.unitsPerBox > 0 ? Math.round(nums.unitsPerBox) : undefined;
    await db.product.upsert({
      where: { code: r.code },
      update: { name: r.name, capacity: r.capacity || undefined, packUnit: r.packUnit || undefined, unitsPerBox, ...dims },
      create: {
        code: r.code,
        name: r.name,
        capacity: r.capacity || null,
        packUnit: r.packUnit || "박스",
        unitsPerBox: unitsPerBox ?? 1,
        category: categoryOf(r.code),
        ...dims,
      },
    });
    inserted++;
  }
  return { ok: true, inserted, skipped, errors, newProducts: created, newCustomers: 0, updated: inserted - created };
}

// ───────────────────────── CUSTOMER ─────────────────────────

export async function importCustomers(db: Db, sheet: string[][]): Promise<ImportOutcome> {
  const mapped = applyMapping(sheet, CUSTOMER_MAPPING);
  if (!mapped.ok) return mapped;
  const errors: RowError[] = [];
  let inserted = 0;
  let skipped = 0;
  let created = 0;
  const codes = mapped.rows.map((r) => r.code || r.name).filter(Boolean);
  const existing = new Set((await db.customer.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
  for (const r of mapped.rows) {
    const code = r.code || r.name;
    if (!code) {
      skipped++;
      continue;
    }
    if (!existing.has(code)) created++;
    const t = r.type.toUpperCase().replace(/\s/g, "");
    const type = t.includes("B2B") ? "B2B" : t.includes("B2C") ? "B2C" : null;
    const u = r.orderUnit.toUpperCase();
    const orderUnit =
      u.includes("차량") || u.includes("VEHICLE") ? "VEHICLE" : u.includes("박스") || u.includes("BOX") ? "BOX" : null;
    await db.customer.upsert({
      where: { code },
      update: {
        name: r.name || code,
        ...(type ? { type, typeSource: "MANUAL" } : {}),
        ...(orderUnit ? { orderUnit } : {}),
      },
      create: {
        code,
        name: r.name || code,
        type: type ?? "B2C",
        typeSource: type ? "MANUAL" : "AUTO",
        orderUnit: orderUnit ?? "BOX",
      },
    });
    inserted++;
  }
  return { ok: true, inserted, skipped, errors, newProducts: 0, newCustomers: created, updated: inserted - created };
}
