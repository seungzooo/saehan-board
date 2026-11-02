/**
 * 헤더 행을 config/excel-mapping.ts의 매핑으로 해석해 객체 배열로 바꾼다.
 * 필수 컬럼이 없으면 어느 컬럼이 없는지 돌려주고 (호출측은 저장하지 않는다).
 */
import type { ColumnMapping } from "@/config/excel-mapping";

export type MappedRows<F extends string> = {
  ok: true;
  columns: Record<F, number | null>;
  rows: Array<Record<F, string> & { __row: number }>;
};
export type MappingError = {
  ok: false;
  missing: string[]; // 못 찾은 필수 필드의 헤더 후보 (사용자 표시용)
  headerFound: string[];
};

export function normalizeHeader(h: string): string {
  return h.replace(/\s+/g, "").replace(/^\uFEFF/, "").toLowerCase();
}

export function applyMapping<F extends string>(
  sheet: string[][],
  mapping: ColumnMapping<F>,
): MappedRows<F> | MappingError {
  if (sheet.length === 0) return { ok: false, missing: ["(빈 파일)"], headerFound: [] };
  const header = sheet[0].map(normalizeHeader);
  const columns = {} as Record<F, number | null>;
  const missing: string[] = [];
  for (const field of Object.keys(mapping) as F[]) {
    const spec = mapping[field];
    let idx: number | null = null;
    for (const cand of spec.headers) {
      const i = header.indexOf(normalizeHeader(cand));
      if (i >= 0) {
        idx = i;
        break;
      }
    }
    columns[field] = idx;
    if (idx === null && spec.required) missing.push(spec.headers.join(" / "));
  }
  if (missing.length > 0) return { ok: false, missing, headerFound: sheet[0] };

  const rows: MappedRows<F>["rows"] = [];
  for (let r = 1; r < sheet.length; r++) {
    const src = sheet[r];
    const obj = { __row: r + 1 } as Record<F, string> & { __row: number };
    for (const field of Object.keys(columns) as F[]) {
      const i = columns[field];
      obj[field] = (i === null ? "" : (src[i] ?? "")).trim() as never;
    }
    rows.push(obj);
  }
  return { ok: true, columns, rows };
}

/** "12,345" / "1.5" / "" → number. 빈 값은 0 */
export function toNumber(s: string): number {
  if (!s) return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

/** "2025-01-01", "2025/01/01", "20250101" → "YYYY-MM-DD". 실패 시 null */
export function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (!m) m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "21 본가공입고" → "21" */
export function slipTypeCode(s: string): string {
  const m = s.trim().match(/^(\d+)/);
  return m ? m[1] : s.trim();
}

/** 품번 접두어 (영문 2글자) */
export function productPrefix(code: string): string {
  const m = code.trim().match(/^([A-Za-z]+)/);
  return m ? m[1].toUpperCase().slice(0, 2) : "";
}
