/**
 * 영업 조회 흐름 — 읽기 전용. 거래처 검색 → 최근 12개월 정상 출고 품목 → 품목 상세 → 요청 수량 계산·복사 문구.
 * 거래처 목록의 현재 재고와 상세의 현재 재고(개 환산)·기준 시각이 같은지 확인한다.
 */
import { expect, test } from "@playwright/test";

const CUSTOMER = process.env.E2E_CUSTOMER ?? "대상";

test("거래처 검색 → 품목 목록(기간 표시, 확인 필요는 아래) → 상세 수량 일치 → 요청 계산", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("customer-entry").click();
  await expect(page).toHaveURL(/\/stock\/customers/);
  await page.getByRole("searchbox", { name: "거래처 검색" }).fill(CUSTOMER);
  await page.getByRole("button", { name: "찾기" }).click();
  const hit = page.getByTestId("customer-hit").first();
  await expect(hit).toBeVisible();
  await hit.click();

  // 기간: 실제 시작월~종료월 (12개 달)
  const period = page.getByTestId("customer-period");
  await expect(period).toContainText(/\d{4}-\d{2} ~ \d{4}-\d{2}/);
  const [from, to] = ((await period.innerText()).match(/(\d{4}-\d{2}) ~ (\d{4}-\d{2})/) ?? []).slice(1);
  const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
  expect(months).toBe(12);

  // 확인 필요 품목은 확인된 품목 뒤(아래 묶음)에만
  const items = page.getByTestId("customer-item");
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  let seenUnchecked = false;
  for (let i = 0; i < n; i++) {
    const unchecked = (await items.nth(i).getByTestId("customer-item-qty").innerText()) === "확인 필요";
    if (unchecked) seenUnchecked = true;
    else expect(seenUnchecked, "확인된 품목이 확인 필요 품목 아래에 있음").toBe(false);
  }

  // 확인된 품목이 있으면: 목록 수량·집계 시각 = 상세 수량·집계 시각
  const first = items.first();
  const listQty = await first.getByTestId("customer-item-qty").innerText();
  test.skip(listQty === "확인 필요", "이 거래처 품목이 모두 최근 재고 파일에 없음 — 수량 일치는 demo 시나리오에서 확인");
  const listAsOf = (await first.getByTestId("customer-item-asof").innerText()).replace("집계 ", "");
  await first.click();
  await expect(page.getByText("← 거래처 품목")).toBeVisible();
  await expect(page.getByTestId("available-units")).toHaveText(`= ${listQty}`);
  await expect(page.getByTestId("stock-summary")).toContainText(listAsOf);

  // 요청 수량 계산 — 결과 줄과 복사 문구가 같은 산식
  await page.getByTestId("request-qty").fill("100");
  const result = page.getByTestId("request-result");
  await expect(result).toContainText("요청 100개");
  const line = await result.innerText();
  await expect(page.getByTestId("copy-text")).toContainText(line);
  await expect(page.getByTestId("copy-text")).toContainText("재고 집계 기준");
  await expect(page.getByTestId("copy-text")).not.toContainText("확보 완료");
});
