/**
 * 분석 화면 표의 "현재 재고" 칸 — 재고 상세(/stock/[code])와 같은 계산값(computeForProducts·getShipmentRates)을 실제 원인에 맞게 보여 준다.
 * - 확인 필요(최근 재고 파일에 없음): "재고 확인 필요" → 품목 상세. 소진일수 칸은 비운다(같은 이유로 경고를 반복하지 않음)
 * - 확인된 0: "0박스" (미확인과 구분)
 * - 확인 수량: 단위(박스) + 집계 기준 시각, 오늘 자료 미반영이면 그 표시
 * - 소진일수 산정 불가(비교 기간 출고 없음): "비교 기간 출고 없음" → 출고 이력. 간헐 품목 12개월 평균 규칙은 lib/stock 그대로
 * 순수 함수 — 테스트 tests/stockCell.test.ts
 */
import type { AvailableStock } from "@/lib/availableStock";
import { formatShort } from "@/lib/format";
import type { DaysOfStock } from "@/lib/stock";
import { daysNumText, isStockStale, rateLabel } from "@/lib/stockDisplay";

export type StockCell = {
  state: "CHECK" | "STALE" | "ZERO" | "OK";
  text: string;
  sub: string | null;
  tone: string;
  days: { text: string } | null;
  reasons: string[];
  actions: { label: string; href: string }[];
};

export function stockCell(code: string, stock: AvailableStock, days: DaysOfStock, now = new Date()): StockCell {
  const detailHref = `/stock/${encodeURIComponent(code)}`;
  if (stock.available === null) {
    return {
      state: "CHECK",
      text: "재고 확인 필요",
      sub: "품목 상세 →",
      tone: "text-zinc-600",
      days: null,
      reasons: ["최근 재고 파일에 이 품목이 없어 현재 재고를 모릅니다(미등록·미확인). 순위는 출고 실적 기준이라 그대로 둡니다. 소진일수도 재고를 알아야 낼 수 있습니다."],
      actions: [{ label: "재고 확인 필요 → 품목 상세", href: detailHref }],
    };
  }
  const at = stock.stockAsOf ?? stock.uploadedAt;
  const sub = at ? `집계 ${formatShort(at)}` : "집계 시각 미확인";
  const stale = isStockStale(stock, now);
  const zero = stock.available <= 0;
  const reasons: string[] = [];
  const actions: { label: string; href: string }[] = [];
  if (stale) reasons.push("오늘 자료 미반영 — 마지막으로 확인된 수량과 시각입니다.");
  if (zero) reasons.push(`확인된 재고 ${stock.available.toLocaleString()}박스 (재고 파일에 있음 — 미확인과 다름).`);
  let daysView: { text: string };
  if (days.days === null) {
    daysView = { text: "소진 산정 불가" };
    reasons.push(
      `소진일수 산정 불가 — 비교 기간 출고 없음: ${rateLabel(days.window)}을 낼 정상·내수 출고가 없습니다${days.basisTo ? ` (실적 ${days.basisTo}까지)` : ""}.`,
    );
    actions.push({ label: "비교 기간 출고 없음 → 출고 이력", href: `/analytics?code=${encodeURIComponent(code)}` });
  } else {
    daysView = { text: `소진 ${daysNumText(days.days, days.window)}` };
    reasons.push(`예상 소진 ${daysNumText(days.days, days.window)} = 현재 재고 ÷ ${rateLabel(days.window)} ${Number((days.avgPerDay ?? 0).toFixed(2)).toLocaleString()}박스.`);
  }
  actions.push({ label: "품목 상세", href: detailHref });
  return {
    state: stale ? "STALE" : zero ? "ZERO" : "OK",
    text: `${stock.available.toLocaleString()}박스`,
    sub: stale ? `${sub} · 오늘 자료 미반영` : sub,
    tone: zero ? "text-red-600" : stale ? "text-zinc-500" : "text-zinc-900",
    days: daysView,
    reasons,
    actions,
  };
}
