/**
 * docs/data/*.xls (실제로는 CP949 탭 구분 텍스트) → docs/data/clean/*.csv (UTF-8)
 *   npx tsx scripts/clean-data.ts
 *
 * - cp949 디코딩 → 탭 split → 모든 셀 trim
 * - 연도별·팀별 파일을 종류별로 합치고 `원본파일` 컬럼을 추가
 * - 헤더는 첫 파일 기준. 다른 파일의 헤더가 다르면 중단
 */
import fs from "node:fs";
import path from "node:path";
import { parseWorkbookBytes } from "../lib/excel/parse";

const DATA_DIR = path.join(process.cwd(), "docs", "data");
const OUT_DIR = path.join(DATA_DIR, "clean");

function csvCell(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function merge(pattern: RegExp, outName: string) {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => pattern.test(f))
    .sort();
  if (files.length === 0) {
    console.warn(`${outName}: 원본 파일 없음 (${pattern})`);
    return;
  }
  let header: string[] | null = null;
  const out: string[] = [];
  let total = 0;
  for (const f of files) {
    const { rows, format } = parseWorkbookBytes(fs.readFileSync(path.join(DATA_DIR, f)));
    const [h, ...body] = rows;
    if (!header) {
      header = h;
      out.push([...header, "원본파일"].map(csvCell).join(","));
    } else if (h.join("\t") !== header.join("\t")) {
      throw new Error(`${f}: 헤더가 첫 파일과 다릅니다.\n  첫 파일: ${header.join(" | ")}\n  이 파일: ${h.join(" | ")}`);
    }
    for (const r of body) out.push([...r, f].map(csvCell).join(","));
    total += body.length;
    console.log(`  ${f} (${format}) ${body.length}행`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, outName), "﻿" + out.join("\n") + "\n", "utf8");
  console.log(`→ ${outName}: ${total}행, 컬럼 ${header!.length + 1}개`);
}

console.log("판매실적");
merge(/^\d{4}년 판매실적\.xls$/, "sales_2021_2025.csv");
console.log("생산실적");
merge(/^\d{4}년 생산실적\(\d{4}\)\.xls$/, "production_2021_2025.csv");
