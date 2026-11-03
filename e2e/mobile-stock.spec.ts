/**
 * 390px: 첫 화면 검색 → 상세 진입 → 첫 화면(스크롤 전)에 현재 재고 수량과 집계 기준 시각이 보이고
 * 가로 스크롤이 없어야 한다. 읽기 전용 — 아무것도 저장하지 않는다.
 */
import { expect, test, type Page } from "@playwright/test";

const QUERY = process.env.E2E_QUERY ?? "1.65L";
const ANALYSIS_CODE = process.env.E2E_ANALYSIS_CODE ?? "TM00655";

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

test("390px 첫 화면 검색 → 상세: 수량·집계 시각이 첫 화면에, 가로 스크롤 없음", async ({ page }) => {
  await page.goto("/");
  const search = page.getByRole("searchbox", { name: "품목 검색" });
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  expect((await search.boundingBox())!.height, "검색창 높이 56px").toBeGreaterThanOrEqual(56);

  await page.goto(`/?q=${encodeURIComponent(QUERY)}`);
  // 확인 필요 품목만 있으면 접힌 "재고 미확인" 묶음을 연다
  if ((await page.locator('main a[href^="/stock/"]:visible').count()) === 0) await page.getByTestId("unchecked-group").locator("summary").click();
  const first = page.locator('main a[href^="/stock/"]:visible').first();
  await expect(first, `"${QUERY}" 검색 결과가 있어야 함`).toBeVisible();
  expect((await first.boundingBox())!.height, "결과 카드 터치 영역 48px 이상").toBeGreaterThanOrEqual(48);
  await expectNoHorizontalScroll(page);
  await first.click();
  await page.waitForURL(/\/stock\/[^/?]+/);

  await expect(page.getByTestId("stock-summary")).toBeVisible();
  await expectInFirstScreen(page, '[data-testid="available"]', "현재 재고 수량");
  const available = await page.getByTestId("available").textContent();
  if (available?.includes("확인 필요")) {
    // 최신 파일에 없는 품목: 시각 대신 확인 필요 안내만
    await expectInFirstScreen(page, '[data-testid="stock-summary"] p:has-text("최근 재고 파일에 이 품목이 없습니다")', "확인 필요 안내");
    await expect(page.getByTestId("stock-summary")).not.toContainText("파일 반영");
  } else {
    await expectInFirstScreen(page, '[data-testid="stock-summary"] p:has-text("집계")', "재고 집계 기준 시각");
    await expect(page.getByTestId("available")).toHaveText(/[\d,]+/);
    const size = await page.getByTestId("available").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, "현재 재고 숫자 48px 이상").toBeGreaterThanOrEqual(48);
  }
  await expectNoHorizontalScroll(page);
});

test("390px 주요 화면에 가로 스크롤 없음", async ({ page }) => {
  for (const path of ["/", "/stock?unchecked=1", "/adjust", "/upload", "/analytics", `/analytics?code=${ANALYSIS_CODE}`]) {
    await page.goto(path);
    await expectNoHorizontalScroll(page);
  }
});
