import iconv from "iconv-lite";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { SALES_MAPPING, STOCK_MAPPING } from "@/config/excel-mapping";
import { parseCsvText } from "@/lib/excel/csv";
import { applyMapping, slipTypeCode, toIsoDate, toNumber } from "@/lib/excel/mapping";
import { parseWorkbookBytes } from "@/lib/excel/parse";

describe("parseWorkbookBytes", () => {
  it("CP949 탭 구분 텍스트(.xls 위장)를 읽고 trim한다", () => {
    const text = "품 번\t품명/규격\t재고수량\r\nTM00329\t지평 1.7L 쌀막걸리   \t120\r\n\r\n";
    const bytes = iconv.encode(text, "cp949");
    const r = parseWorkbookBytes(bytes);
    expect(r.format).toBe("text-cp949");
    expect(r.rows).toEqual([
      ["품 번", "품명/규격", "재고수량"],
      ["TM00329", "지평 1.7L 쌀막걸리", "120"],
    ]);
  });

  it("UTF-8 BOM CSV를 읽는다", () => {
    const bytes = Buffer.from("﻿품번,재고수량\nEM001,\"1,200\"\n", "utf8");
    const r = parseWorkbookBytes(bytes);
    expect(r.format).toBe("text-utf8");
    expect(r.rows[1]).toEqual(["EM001", "1,200"]);
  });

  it("진짜 xlsx를 읽는다", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["품번", "품명/규격", "재고수량"],
      ["FM010", "쌀용기 2L", 35],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "재고");
    const bytes = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const r = parseWorkbookBytes(bytes);
    expect(r.format).toBe("xlsx");
    expect(r.rows[1]).toEqual(["FM010", "쌀용기 2L", "35"]);
  });
});

describe("applyMapping", () => {
  it("헤더 공백 차이를 무시하고 매핑한다", () => {
    const m = applyMapping(
      [
        ["품번", "품명", "재고"],
        ["A1", "x", "3"],
      ],
      STOCK_MAPPING,
    );
    expect(m.ok).toBe(true);
    if (m.ok) expect(m.rows[0]).toMatchObject({ productCode: "A1", productName: "x", qtyBox: "3", __row: 2 });
  });

  it("필수 컬럼이 없으면 어느 컬럼인지 알려주고 실패한다", () => {
    const m = applyMapping([["출고일자", "품번"]], SALES_MAPPING);
    expect(m.ok).toBe(false);
    if (!m.ok) {
      expect(m.missing).toContain("출고구분");
      expect(m.missing).toContain("출고수량");
      expect(m.missing).not.toContain("출고일자");
    }
  });
});

describe("helpers", () => {
  it("toNumber / toIsoDate / slipTypeCode", () => {
    expect(toNumber("12,345")).toBe(12345);
    expect(toNumber("")).toBe(0);
    expect(toNumber("abc")).toBeNaN();
    expect(toIsoDate("2025-1-5")).toBe("2025-01-05");
    expect(toIsoDate("2025/01/05 00:00")).toBe("2025-01-05");
    expect(toIsoDate("20250105")).toBe("2025-01-05");
    expect(toIsoDate("hello")).toBeNull();
    expect(slipTypeCode("32 재가공투입")).toBe("32");
  });

  it("parseCsvText는 따옴표 안의 쉼표·개행을 처리한다", () => {
    expect(parseCsvText('a,"b,c","d""e"\n1,"x\ny",3\n')).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "x\ny", "3"],
    ]);
  });
});
