/** 재고 화면 설정 */

/** 마지막 파일 반영 후 이 시간이 지나면 "갱신 지연" 배지 */
export const STALE_AFTER_HOURS = 24;

/** 저재고 기준: 예상 소진일수가 이 값 이하 (확인된 품목 중) */
export const LOW_DAYS_THRESHOLD = 3;

/** 일평균 출고 산정 창(일). 출고실적(정상·내수)의 마지막 날짜를 끝으로 거슬러 센다 */
export const SHIPMENT_WINDOW_DAYS = 30;
