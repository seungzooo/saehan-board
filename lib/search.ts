/**
 * 검색·용량 인식 (순수 함수, DB 없음). 테스트: tests/search.test.ts
 *
 * - parseCapacityMl("2L") = 2000, ("2000ml") = 2000, ("1.8L") = 1800, ("450") = 450(ml), ("TM00329") = null
 * - formatCapacity(1800) = "1.8L", (2000) = "2L", (450) = "450ml"
 * - rankProducts: 품번 정확 일치 → 용량 일치 → 이름에 토큰이 온전한 단위로 등장 → 나머지(부분 일치).
 *   단종(품명이 "폐기"로 시작)은 품번 정확 일치가 아니면 맨 아래.
 */

export type SearchableProduct = { code: string; name: string; capacity: string | null };

/** 품명이 "폐기"로 시작하면 단종 */
export function isDiscontinued(name: string): boolean {
  return name.trim().startsWith("폐기");
}

const CAP_RE = /^(\d+(?:\.\d+)?)\s*(l|ℓ|리터|ml|㎖|cc)?$/i;

/** 질의/셀 값을 ml 정수로. 단위 없는 숫자는 ml. 실패 시 null */
export function parseCapacityMl(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  const m = t.match(CAP_RE);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  const ml = unit === "l" || unit === "ℓ" || unit === "리터" ? n * 1000 : n;
  return Math.round(ml);
}

/** 제품의 용량(ml). capacity 컬럼 우선, 없으면 이름에서 "1.7L"·"500ml" 패턴 */
export function productCapacityMl(p: SearchableProduct): number | null {
  if (p.capacity) {
    const c = parseCapacityMl(p.capacity);
    if (c) return c;
  }
  const m = p.name.match(/(\d+(?:\.\d+)?)\s*(L|ℓ|ml|㎖)(?![A-Za-z])/i);
  return m ? parseCapacityMl(`${m[1]}${m[2]}`) : null;
}

/** ml → "2L" / "1.8L" / "450ml". 0·null → null */
export function formatCapacity(ml: number | null | undefined): string | null {
  if (!ml || ml <= 0) return null;
  if (ml >= 1000) {
    const l = ml / 1000;
    return `${Number.isInteger(l) ? l : Number(l.toFixed(2))}L`;
  }
  return `${ml}ml`;
}

/** 제품 표시용 용량 문자열 */
export function productCapacityLabel(p: SearchableProduct): string | null {
  return formatCapacity(productCapacityMl(p));
}

/** 이름 안에 토큰이 "온전한 단위"로 등장하는가 — "2L"은 "12L"·"22L"·"1.2L"에 매치되지 않는다 */
export function nameHasWholeToken(name: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9.])${esc}(?![0-9])`, "i").test(name);
}

export type RankedProduct<T> = { item: T; rank: number };

/**
 * 순위: 0 품번 정확 일치 · 1 용량 일치 · 2 이름에 온전한 토큰 · 3 그 외.
 * 같은 순위 안에서는 이름 오름차순.
 */
export function rankProducts<T extends SearchableProduct>(items: T[], query: string): T[] {
  const q = query.trim();
  const qLower = q.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  const capTokens = tokens.map(parseCapacityMl).filter((v): v is number => v !== null);

  const ranked: RankedProduct<T>[] = items.map((item) => {
    if (item.code.toLowerCase() === qLower) return { item, rank: 0 };
    const cap = productCapacityMl(item);
    if (capTokens.length > 0 && cap !== null && capTokens.includes(cap)) return { item, rank: 1 };
    if (tokens.length > 0 && tokens.every((t) => nameHasWholeToken(item.name, t) || item.code.toLowerCase().includes(t.toLowerCase())))
      return { item, rank: 2 };
    return { item, rank: 3 };
  });
  const tail = (r: RankedProduct<T>) => (r.rank > 0 && isDiscontinued(r.item.name) ? 1 : 0);
  return ranked
    .sort((a, b) => tail(a) - tail(b) || a.rank - b.rank || a.item.name.localeCompare(b.item.name, "ko"))
    .map((r) => r.item);
}

/** 검색어에서 DB 후보 조회용 용량 문자열들 — "2L" → ["2000", "2L", "2.0L", "2000ml"] */
export function capacityQueryVariants(token: string): string[] {
  const ml = parseCapacityMl(token);
  if (ml === null) return [];
  const out = new Set<string>([String(ml), `${ml}ml`]);
  if (ml >= 1000) {
    const l = ml / 1000;
    out.add(`${l}L`);
    if (Number.isInteger(l)) out.add(`${l}.0L`);
  }
  return [...out];
}
