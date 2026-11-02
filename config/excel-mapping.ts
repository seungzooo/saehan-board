/**
 * ERP 엑셀 → 앱 필드 매핑.
 * 실제 엑셀 샘플이 바뀌면 이 파일만 수정한다.
 *
 * 각 항목: 앱 필드명 → 엑셀 헤더 후보 목록 (앞에서부터 먼저 발견된 헤더 사용).
 * 헤더는 trim + 내부 공백 제거 후 비교하므로 "품 번"과 "품번"은 같은 것으로 본다.
 * 정확히 일치하는 헤더가 없으면 후보를 포함하는 헤더를 찾는다 — "재고수량(박스)"도 "재고수량"으로 통과.
 * (세부 규칙: lib/excel/mapping.ts applyMapping)
 */

export type ColumnMapping<F extends string> = {
  [K in F]: { headers: string[]; required: boolean };
};

export type UploadKind = "STOCK" | "SALES" | "PRODUCTION" | "PRODUCT" | "CUSTOMER";

/** 재고 엑셀 — 샘플 미수령. 기본 가정: 품번 / 품명/규격 / 재고수량 (박스) */
export const STOCK_MAPPING = {
  productCode: { headers: ["품번", "품 번", "제품코드", "품목코드"], required: true },
  productName: { headers: ["품명/규격", "품명", "제품명"], required: false },
  qtyBox: { headers: ["재고수량", "재고", "박스수", "현재고"], required: true },
} satisfies ColumnMapping<"productCode" | "productName" | "qtyBox">;

/** 판매실적 (docs/data/*년 판매실적.xls) */
export const SALES_MAPPING = {
  date: { headers: ["출고일자"], required: true },
  slipNo: { headers: ["전표번호"], required: false },
  shipType: { headers: ["출고구분"], required: true },
  salesType: { headers: ["판매형태"], required: true },
  productCode: { headers: ["품번", "품 번"], required: true },
  itemType: { headers: ["품종", "품 종"], required: false },
  productName: { headers: ["품명/규격", "품명"], required: true },
  customerName: { headers: ["거래선", "거래선명", "거래처"], required: true },
  capacity: { headers: ["용량"], required: false },
  packUnit: { headers: ["포장단위"], required: false },
  unitsPerBox: { headers: ["포장단위수량"], required: true },
  qtyUnits: { headers: ["출고수량"], required: true },
} satisfies ColumnMapping<
  | "date" | "slipNo" | "shipType" | "salesType" | "productCode" | "itemType"
  | "productName" | "customerName" | "capacity" | "packUnit" | "unitsPerBox" | "qtyUnits"
>;

/** 생산실적 (docs/data/*년 생산실적(1211|1212|1219).xls) */
export const PRODUCTION_MAPPING = {
  date: { headers: ["생산일자"], required: true },
  dept: { headers: ["생산부서"], required: false },
  shift: { headers: ["작업조"], required: false },
  machine: { headers: ["생산호기"], required: false },
  workOrderNo: { headers: ["작업지시번호", "지시번호"], required: false },
  productCode: { headers: ["생산품번", "품번", "품 번"], required: true },
  itemType: { headers: ["생산품종", "품종"], required: false },
  productName: { headers: ["품명/규격", "품명"], required: false },
  packUnit: { headers: ["포장단위"], required: false },
  slipType: { headers: ["전표구분"], required: true },
  unitsPerBox: { headers: ["포장단위수량"], required: false },
  qtyGood: { headers: ["수량(A급)", "A급", "양품"], required: true },
  qtyDefect: { headers: ["수량(C급)", "C급", "불량"], required: false },
} satisfies ColumnMapping<
  | "date" | "dept" | "shift" | "machine" | "workOrderNo" | "productCode" | "itemType" | "productName"
  | "packUnit" | "slipType" | "unitsPerBox" | "qtyGood" | "qtyDefect"
>;

/** 제품 마스터 엑셀 — 박스 규격 포함 */
export const PRODUCT_MAPPING = {
  code: { headers: ["품번", "품 번", "제품코드"], required: true },
  name: { headers: ["품명/규격", "품명", "제품명"], required: true },
  capacity: { headers: ["용량"], required: false },
  packUnit: { headers: ["포장단위"], required: false },
  unitsPerBox: { headers: ["포장단위수량", "입수", "박스입수"], required: false },
  boxW: { headers: ["가로", "박스가로", "W"], required: false },
  boxD: { headers: ["세로", "박스세로", "D"], required: false },
  boxH: { headers: ["높이", "박스높이", "H"], required: false },
} satisfies ColumnMapping<
  "code" | "name" | "capacity" | "packUnit" | "unitsPerBox" | "boxW" | "boxD" | "boxH"
>;

/** 거래처 마스터 — 이사님 B2B/B2C 분류표 */
export const CUSTOMER_MAPPING = {
  code: { headers: ["거래선코드", "거래처코드", "코드"], required: false },
  name: { headers: ["거래선", "거래선명", "거래처", "거래처명"], required: true },
  type: { headers: ["구분", "유형", "type", "B2B/B2C"], required: false },
  orderUnit: { headers: ["주문단위", "발주단위"], required: false },
} satisfies ColumnMapping<"code" | "name" | "type" | "orderUnit">;

export const MAPPINGS: Record<UploadKind, ColumnMapping<string>> = {
  STOCK: STOCK_MAPPING,
  SALES: SALES_MAPPING,
  PRODUCTION: PRODUCTION_MAPPING,
  PRODUCT: PRODUCT_MAPPING,
  CUSTOMER: CUSTOMER_MAPPING,
};

/** 전표구분 코드 중 생산으로 집계하는 것. 32 재가공투입은 소모라 제외 */
export const PRODUCTION_SLIP_TYPES = ["21", "22"] as const;

/** 추이 분석에 쓰는 출고 조건 */
export const ANALYSIS_SHIP_TYPE = "정상";
export const ANALYSIS_SALES_TYPE = "내수";

/** 품번 접두어 → 생산팀 분류 */
export const CATEGORY_BY_PREFIX: Record<string, string> = {
  TM: "PET1",
  TR: "PET1",
  EM: "PE",
  FM: "PET2",
  AM: "사입",
  TY: "사입",
  WM: "사입",
};

/** 거래선 B2B 기본 판정: 5년 출고 건수 100건 초과 */
export const B2B_MIN_SHIPMENT_COUNT = 100;
