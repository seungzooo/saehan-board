/** 재고 화면 설정 */

/**
 * 오늘 자료 미반영 판정: 품목의 재고 집계 기준 시각(없으면 파일 반영 시각)에서 이 시간이 지나면
 * "오늘 자료 미반영" — 마지막 확인 수량·시각은 보여주되 출고 가능 판정은 보류한다. 헤더의 "갱신 지연" 배지도 같은 값.
 */
export const STALE_AFTER_HOURS = 24;

/** 저재고 기준: 예상 소진일수가 이 값 이하 (확인된 품목 중) */
export const LOW_DAYS_THRESHOLD = 3;

/** 일평균 출고 산정 창(일). 출고실적(정상·내수)의 마지막 날짜를 끝으로 거슬러 센다 */
export const SHIPMENT_WINDOW_DAYS = 30;

/**
 * 간헐 출고 품목의 소진일수: 최근 RATE_LONG_MONTHS(12)개 달 중 정상·내수 출고가 있는 달이 INTERMITTENT_MAX_MONTHS(6)개 이하이면
 * 30일 평균 대신 "최근 12개월 일평균"(그 12개 달 출고 합 ÷ 그 기간 일수)으로 소진일수를 낸다. 화면에 "(12개월 평균)" 표시.
 * 12개 달 = 실적 마지막 날짜가 속한 달 포함 거슬러 12개 달, 기간 일수 = 첫 달 1일 ~ 실적 마지막 날짜.
 */
export const RATE_LONG_MONTHS = 12;
export const INTERMITTENT_MAX_MONTHS = 6;

/** 관리 대상 = 기준월(최근 정상·내수 출고일이 속한 달) 포함 최근 N개 달에 정상·내수 출고가 있는 품번 */
export const ACTIVE_MONTHS = 12;

/** 미확인 목록 정렬에 쓰는 "최근 N개 달 출고량" */
export const RECENT_QTY_MONTHS = 3;

/** 재고 목록 한 페이지 */
export const LIST_PAGE_SIZE = 50;
