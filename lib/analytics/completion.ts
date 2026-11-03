/**
 * 집계 완료 월 — 순수 함수 (DB 없음). 테스트: tests/completion.test.ts
 *
 * 업로드할 때 담당자가 "이 파일의 집계 완료 월"을 정한다(기본값 자동 제안). 앱은 복구되지 않은 배치 중
 * 가장 최근에 올린 배치의 값을 쓴다. 마지막 출고일만으로 그 달이 끝났다고 보지 않는다 — 제안은 담당자가 확인·수정한다.
 */

/** 그 달의 마지막 영업일 (토·일 제외, 공휴일은 고려하지 않음) */
export function lastBusinessDay(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0)); // 그 달 말일
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * 기본 제안: 파일 안 마지막 출고일이 그 달 말일 또는 마지막 영업일 이후면 그 달, 아니면 전달.
 *   2026-03-15 → 2026-02 (3월은 집계 중) · 2026-03-31 → 2026-03 · 2026-05-29(금, 30·31일 주말) → 2026-05
 */
export function suggestCompleteMonth(lastDate: string): string {
  const ym = lastDate.slice(0, 7);
  return lastDate >= lastBusinessDay(ym) ? ym : prevYm(ym);
}

export type CompletionBatch = {
  id: string;
  kind: string;
  fileName: string;
  uploadedAt: Date | string;
  completeThrough: string | null;
  revertedAt: Date | string | null;
};

/** 앱이 쓰는 값: 복구되지 않았고 값이 있는 배치 중 가장 최근에 올린 배치 */
export function effectiveCompletion(batches: CompletionBatch[], kind: "SALES" | "PRODUCTION"): CompletionBatch | null {
  const t = (d: Date | string) => new Date(d).getTime();
  return (
    batches
      .filter((b) => b.kind === kind && !b.revertedAt && b.completeThrough)
      .sort((a, b) => t(b.uploadedAt) - t(a.uploadedAt))[0] ?? null
  );
}

/** 입력 검증: YYYY-MM, 파일의 마지막 자료 달보다 늦을 수 없다 */
export function validateCompleteMonth(value: string, lastDataYm: string | null): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return "집계 완료 월은 YYYY-MM 형식이어야 합니다.";
  if (lastDataYm && value > lastDataYm) return `파일의 마지막 자료 달(${lastDataYm})보다 늦을 수 없습니다.`;
  return null;
}
