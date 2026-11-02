/**
 * 업로드 파일(bytes) → 문자열 2차원 배열.
 *
 * ERP(몰드) 내보내기 파일은 확장자가 .xls지만 실제로는 CP949 탭 구분 텍스트다.
 * 매직 바이트로 형식을 판별한다:
 *   - "PK\x03\x04"      → xlsx (zip)        → SheetJS
 *   - "\xD0\xCF\x11\xE0" → 진짜 xls (BIFF)  → SheetJS
 *   - 그 외             → 텍스트. UTF-8 BOM이 있거나 UTF-8로 깨끗이 디코딩되면 UTF-8, 아니면 CP949
 *                        구분자는 첫 줄의 탭/쉼표 개수로 결정
 */
import iconv from "iconv-lite";
import * as XLSX from "xlsx";
import { parseCsvText } from "./csv";

export type ParsedSheet = {
  format: "xlsx" | "xls" | "text-cp949" | "text-utf8";
  rows: string[][]; // 첫 행 = 헤더. 모든 셀 trim 완료
};

export function parseWorkbookBytes(buf: Uint8Array): ParsedSheet {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (isZip(b)) return { format: "xlsx", rows: sheetToRows(b) };
  if (isBiff(b)) return { format: "xls", rows: sheetToRows(b) };
  return parseTextBytes(b);
}

function isZip(b: Buffer) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}
function isBiff(b: Buffer) {
  return b.length > 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
}

function sheetToRows(b: Buffer): string[][] {
  const wb = XLSX.read(b, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });
  return aoa.map((r) => r.map((c) => cellToString(c))).filter((r) => r.some((c) => c !== ""));
}

function cellToString(c: unknown): string {
  if (c == null) return "";
  if (c instanceof Date) return formatDate(c);
  return String(c).trim();
}

function parseTextBytes(b: Buffer): ParsedSheet {
  let text: string;
  let format: ParsedSheet["format"];
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    text = b.subarray(3).toString("utf8");
    format = "text-utf8";
  } else if (looksUtf8(b)) {
    text = b.toString("utf8");
    format = "text-utf8";
  } else {
    text = iconv.decode(b, "cp949");
    format = "text-cp949";
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const rows = tabs >= commas ? splitTabs(text) : parseCsvText(text);
  return { format, rows: rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== "")) };
}

function splitTabs(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => line.split("\t"));
}

/** 한글이 포함된 CP949 바이트는 UTF-8로 디코딩하면 U+FFFD가 생긴다 */
function looksUtf8(b: Buffer): boolean {
  const sample = b.subarray(0, Math.min(b.length, 64 * 1024));
  const decoded = sample.toString("utf8");
  return !decoded.includes("\uFFFD");
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
