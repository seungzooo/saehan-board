import { describe, expect, it } from "vitest";
import {
  capacityQueryVariants,
  formatCapacity,
  nameHasWholeToken,
  parseCapacityMl,
  productCapacityMl,
  rankProducts,
} from "@/lib/search";

describe("용량 인식", () => {
  it("parseCapacityMl", () => {
    expect(parseCapacityMl("2L")).toBe(2000);
    expect(parseCapacityMl("2000ml")).toBe(2000);
    expect(parseCapacityMl("2000")).toBe(2000);
    expect(parseCapacityMl("1.8L")).toBe(1800);
    expect(parseCapacityMl("1.2 L")).toBe(1200);
    expect(parseCapacityMl("450")).toBe(450);
    expect(parseCapacityMl("0")).toBeNull();
    expect(parseCapacityMl("TM00329")).toBeNull();
    expect(parseCapacityMl("식용유")).toBeNull();
  });

  it("formatCapacity: ml → L 변환", () => {
    expect(formatCapacity(2000)).toBe("2L");
    expect(formatCapacity(1800)).toBe("1.8L");
    expect(formatCapacity(1700)).toBe("1.7L");
    expect(formatCapacity(450)).toBe("450ml");
    expect(formatCapacity(0)).toBeNull();
    expect(formatCapacity(null)).toBeNull();
  });

  it("productCapacityMl: capacity 컬럼 우선, 없으면 이름에서", () => {
    expect(productCapacityMl({ code: "A", name: "x", capacity: "1800" })).toBe(1800);
    expect(productCapacityMl({ code: "A", name: "지평 1.7L 쌀막걸리", capacity: "0" })).toBe(1700);
    expect(productCapacityMl({ code: "A", name: "PE 말통 캡", capacity: null })).toBeNull();
  });

  it("nameHasWholeToken: 2L은 12L·22L·1.2L에 매치되지 않는다", () => {
    expect(nameHasWholeToken("쌀용기 2L 사각", "2L")).toBe(true);
    expect(nameHasWholeToken("2L 물통", "2L")).toBe(true);
    expect(nameHasWholeToken("말통 12L", "2L")).toBe(false);
    expect(nameHasWholeToken("말통 22L", "2L")).toBe(false);
    expect(nameHasWholeToken("올리고당 1.2L", "2L")).toBe(false);
    expect(nameHasWholeToken("물통 2LX", "2L")).toBe(true);
  });

  it("capacityQueryVariants", () => {
    expect(capacityQueryVariants("2L").sort()).toEqual(["2.0L", "2000", "2000ml", "2L"].sort());
    expect(capacityQueryVariants("450")).toEqual(["450", "450ml"]);
    expect(capacityQueryVariants("식용유")).toEqual([]);
  });
});

describe("rankProducts", () => {
  const items = [
    { code: "TM00001", name: "말통 12L", capacity: "12000" },
    { code: "TM00002", name: "올리고당 1.2L", capacity: "1200" },
    { code: "TM00003", name: "쌀용기 2L 사각", capacity: "2000" },
    { code: "TM00004", name: "식용유 2000ml", capacity: "2000" },
    { code: "TM00005", name: "물통 22L", capacity: "22000" },
    { code: "TM00006", name: "생수병", capacity: "2000" },
    { code: "2L", name: "품번이 2L인 품목", capacity: null },
  ];

  it("'2L': 품번 정확 일치 → 2L·2000·2000ml → 12L·22L·1.2L", () => {
    const codes = rankProducts(items, "2L").map((p) => p.code);
    expect(codes[0]).toBe("2L");
    expect(codes.slice(1, 4).sort()).toEqual(["TM00003", "TM00004", "TM00006"]);
    expect(codes.slice(4).sort()).toEqual(["TM00001", "TM00002", "TM00005"]);
  });

  it("'2000ml'도 같은 용량으로 인식", () => {
    const codes = rankProducts(items, "2000ml").map((p) => p.code);
    expect(codes.slice(0, 3).sort()).toEqual(["TM00003", "TM00004", "TM00006"]);
  });

  it("품번 정확 일치는 대소문자 무시", () => {
    expect(rankProducts(items, "tm00005")[0].code).toBe("TM00005");
  });

  it("텍스트 검색은 온전한 토큰 포함 품목이 앞", () => {
    const codes = rankProducts(items, "쌀용기").map((p) => p.code);
    expect(codes[0]).toBe("TM00003");
  });

  it("단종(폐기로 시작)은 맨 아래, 단 품번 정확 일치는 맨 위", () => {
    const list = [
      { code: "P1", name: "폐기 - 쌀용기 2L", capacity: "2000" },
      { code: "P2", name: "쌀용기 2L", capacity: "2000" },
      { code: "P3", name: "말통 12L", capacity: "12000" },
    ];
    expect(rankProducts(list, "2L").map((p) => p.code)).toEqual(["P2", "P3", "P1"]);
    expect(rankProducts(list, "P1")[0].code).toBe("P1");
  });
});
