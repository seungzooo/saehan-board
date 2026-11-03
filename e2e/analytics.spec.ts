/**
 * ② 분석 — 390px. 읽기 전용.
 */
import { expect, test, type Page } from "@playwright/test";

const CODE = process.env.E2E_ANALYSIS_CODE ?? "TM00655";

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(clientWidth);
}

test("품목 분석: 정상 출고 기준·반품 별도·연도별 히트맵·시차 k=0~6과 유효 쌍 수", async ({ page }) => {
  await page.goto(`/analytics?code=${CODE}`);
  await expect(page.getByTestId("analysis-basis")).toContainText("판매 = 정상 출고(판매형태 전체), 반품 별도");
  await expect(page.getByTestId("returns")).toContainText(/반품 [\d,]+박스/);

  const heat = page.getByTestId("year-heatmap");
  await expect(heat.getByRole("rowheader")).toHaveCount(5); // 2021~2025
  await expect(heat.getByRole("cell")).toHaveCount(60);

  const lag = page.getByTestId("lag-table");
  await expect(lag.locator("thead th")).toHaveCount(8); // "k" + 0..6
  await expect(lag.locator("thead")).toContainText("+6");
  await expect(lag.locator("tbody tr").nth(1)).toContainText(/\d+/); // 쌍 수
  await expect(page.getByText(/생산월 t 와 판매월 t\+k/).first()).toBeVisible();
  await expect(page.getByText(/생산월 t ↔ 출고월 t\+\d.*유효 \d+쌍/)).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("전체 요약: 연도별 히트맵·전체 시차 상관·반품 표시, 가로 스크롤 없음", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("year-heatmap")).toBeVisible();
  await expect(page.getByTestId("lag-table")).toBeVisible();
  await expect(page.getByTestId("returns")).toContainText("반품");
  await expectNoHorizontalScroll(page);
});

test("생산 실적 없는 품번은 분석 불가", async ({ page }) => {
  await page.goto("/analytics?code=AMCP029");
  await expect(page.getByTestId("not-analyzable")).toContainText("분석 불가");
});
