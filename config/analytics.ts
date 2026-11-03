/**
 * 분석 화면 설정.
 *
 * SALES_COMPLETE_THROUGH — 출고실적이 "집계 완료"로 확인된 마지막 달 (YYYY-MM).
 * 마지막 출고일만으로 그 달 전체가 집계됐다고 보지 않는다. 규칙(lib/analytics/periods.ts):
 *   - 자료가 있는 달 중 마지막 달보다 앞선 달은, 그 뒤에도 자료가 이어지므로 집계 완료로 본다.
 *   - 마지막 달은 이 값이 그 달 이상일 때만 완료로 본다. 아니면 "집계 중"으로 비교에서 뺀다.
 * 근거(2026-11-03): 판매실적 원본이 연간 보고서(2021~2025년 판매실적.xls, 각 01-01~12-31)이고
 * 2025-12는 26일 출고·12-31까지 기록, 행 수 1,725로 2025년 다른 달(1,973~2,135)과 같은 수준.
 * 새 실적을 올리면 이 값(또는 환경변수 SALES_COMPLETE_THROUGH)을 갱신한다.
 */
export const SALES_COMPLETE_THROUGH: string | null = (process.env.SALES_COMPLETE_THROUGH ?? "2025-12").trim() || null;
