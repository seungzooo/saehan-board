/**
 * 날짜·시각 표시는 모두 Asia/Seoul 기준 (서버가 UTC(Vercel)여도 동일).
 * 형식: YYYY-MM-DD HH:mm (CLAUDE.md 작업 규칙)
 */
export const TIME_ZONE = "Asia/Seoul";

type Parts = { y: string; m: string; d: string; hh: string; mm: string };

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function seoulParts(d: Date): Parts {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) p[part.type] = part.value;
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute };
}

export function formatDateTime(d: Date | string): string {
  const { y, m, d: day, hh, mm } = seoulParts(typeof d === "string" ? new Date(d) : d);
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

export function formatDate(d: Date | string): string {
  const { y, m, d: day } = seoulParts(typeof d === "string" ? new Date(d) : d);
  return `${y}-${m}-${day}`;
}

/** MM-DD HH:mm — 목록용 짧은 형식 */
export function formatShort(d: Date | string): string {
  const { m, d: day, hh, mm } = seoulParts(typeof d === "string" ? new Date(d) : d);
  return `${m}-${day} ${hh}:${mm}`;
}

/** 같은 서울 날짜인지 */
export function isSameSeoulDay(a: Date, b: Date): boolean {
  return formatDate(a) === formatDate(b);
}

/** 마지막 반영 후 STALE_AFTER_HOURS 경과 여부 */
export function isStale(uploadedAt: Date, staleAfterHours: number, now = new Date()): boolean {
  return now.getTime() - uploadedAt.getTime() > staleAfterHours * 3600 * 1000;
}
