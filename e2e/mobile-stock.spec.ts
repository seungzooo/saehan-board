/**
 * 390px: 품목 검색 → 상세 진입 → 첫 화면(스크롤 전)에 가용재고 수량과 집계 기준 시각이 보이고
 * 가로 스크롤이 없어야 한다. 읽기 전용 — 아무것도 저장하지 않는다.
 */
import { expect, test, type Page } from "@playwright/test";

const QUERY = process.env.E2E_QUERY ?? "1.65L";

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(clientWidth);
}

async function expectInFirstScreen(page: Page, selector: string, label: string) {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `${label} 존재`).not.toBeNull();
  const h = page.viewportSize()!.height;
  expect(box!.y, `${label} 가 첫 화면(세로 ${h}px) 안에 있음`).toBeLessThan(h);
  expect(box!.y + box!.height).toBeGreaterThan(0);
}

test("390px 검색 → 상세: 수량·집계 시각이 첫 화면에, 가로 스크롤 없음", async ({ page }) => {
  await page.goto(`/stock?q=${encodeURIComponent(QUERY)}`);
  await expect(page.getByRole("heading", { name: "가용재고 조회" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const first = page.locator("main ul li a").first();
  await expect(first, `"${QUERY}" 검색 결과가 있어야 함`).toBeVisible();
  await first.click();
  await page.waitForURL(/\/stock\/[^/?]+/);

  await expect(page.getByTestId("stock-summary")).toBeVisible();
  await expectInFirstScreen(page, '[data-testid="available"]', "가용재고 수량");
  // "집계 기준 MM-DD HH:mm" 또는 "집계 시각 미확인" 둘 중 하나가 첫 화면에
  await expectInFirstScreen(page, '[data-testid="stock-summary"] p:has-text("집계")', "집계 기준 시각");
  await expect(page.getByTestId("available")).toHaveText(/확인 필요|[\d,]+/);
  await expectNoHorizontalScroll(page);
});

test("390px 홈·검색·변동 입력 화면에 가로 스크롤 없음", async ({ page }) => {
  for (const path of ["/", "/stock", "/adjust", "/upload"]) {
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  }
});
