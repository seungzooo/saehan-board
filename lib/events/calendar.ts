/**
 * 공식 달력(공휴일·대체공휴일·임시공휴일) — docs/data/calendar/kr-holidays.json (출처는 파일 안 sources).
 * 탐지된 변동을 해석할 때만 쓴다: 영업일 수 차이, 기간 안 공휴일, 연휴 전후. 공휴일과 겹쳤다는 것만으로 원인을 단정하지 않는다.
 */
import data from "@/docs/data/calendar/kr-holidays.json";

type Holiday = { date: string; name: string; status?: string };
const HOLIDAYS: Holiday[] = (data as { holidays: Holiday[] }).holidays;
const byDate = new Map(HOLIDAYS.map((h) => [h.date, h]));
export const CALENDAR_SOURCES: { name: string; url: string }[] = (data as { sources: { name: string; url: string }[] }).sources;
export const CALENDAR_YEARS = [...new Set(HOLIDAYS.map((h) => Number(h.date.slice(0, 4))))];

const DAY = 86400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function holidayOf(date: string): Holiday | undefined {
  return byDate.get(date);
}
export function isWeekend(date: string): boolean {
  const w = new Date(ts(date)).getUTCDay();
  return w === 0 || w === 6;
}
/** 영업일 = 토·일·공휴일 제외 (회사 휴무는 기록이 없어 반영하지 않음) */
export function businessDays(from: string, to: string): number {
  let n = 0;
  for (let t = ts(from); t <= ts(to); t += DAY) {
    const d = iso(t);
    if (!isWeekend(d) && !byDate.has(d)) n++;
  }
  return n;
}
/** 기간 안 공휴일 (주말과 겹친 날 포함) */
export function holidaysIn(from: string, to: string): Holiday[] {
  return HOLIDAYS.filter((h) => h.date >= from && h.date <= to);
}
/** 기간 앞뒤 days일 안의 공휴일 (기간 밖) — 연휴 전후 확인용 */
export function holidaysNear(from: string, to: string, days = 7): Holiday[] {
  const a = iso(ts(from) - days * DAY);
  const b = iso(ts(to) + days * DAY);
  return HOLIDAYS.filter((h) => h.date >= a && h.date <= b && (h.date < from || h.date > to));
}
export function calendarCovers(from: string, to: string): boolean {
  return CALENDAR_YEARS.includes(Number(from.slice(0, 4))) && CALENDAR_YEARS.includes(Number(to.slice(0, 4)));
}
export function monthRangeOf(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  return [`${ym}-01`, iso(Date.UTC(y, m, 0))];
}
