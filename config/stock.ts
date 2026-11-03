/** 재고 화면 설정 */

/** 마지막 파일 반영 후 이 시간이 지나면 "갱신 지연" 배지 */
export const STALE_AFTER_HOURS = 24;

/** 저재고 기준: 예상 소진일수가 이 값 이하 (확인된 품목 중) */
export const LOW_DAYS_THRESHOLD = 3;

/** 일평균 출고 산정 창(일). 출고실적(정상·내수)의 마지막 날짜를 끝으로 거슬러 센다 */
export const SHIPMENT_WINDOW_DAYS = 30;

/** 관리 대상 = 기준월(최근 정상·내수 출고일이 속한 달) 포함 최근 N개 달에 정상·내수 출고가 있는 품번 */
export const ACTIVE_MONTHS = 12;

/** 미확인 목록 정렬에 쓰는 "최근 N개 달 출고량" */
export const RECENT_QTY_MONTHS = 3;

/** 재고 목록 한 페이지 */
export const LIST_PAGE_SIZE = 50;
