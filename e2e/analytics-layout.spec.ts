/**
 * 분석 화면 각 영역을 390px(터치)·1280px(클릭)에서 눌러 상세가 펼쳐지는지, 가로 스크롤이 없는지. 읽기 전용.
 */
import { expect, test, type Page } from "@playwright/test";

async function noHScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "가로 스크롤 없음").toBeLessThanOrEqual(0);
}

for (const [width, touch] of [
  [390, true],
  [1280, false],
] as const) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch });

    test("영역마다 선택하면 바로 아래 상세 하나, 가로 스크롤 없음", async ({ page }) => {
      test.setTimeout(150_000);
      const press = async (loc: ReturnType<Page["locator"]>) => (touch ? loc.tap() : loc.click());
      await page.goto("/analytics?year=2025");
      for (const id of ["monthly", "season", "lag", "top", "industry"]) await expect(page.getByTestId(`question-${id}`)).toBeVisible();
      await noHScroll(page);

      // 월별 출고: 차트 칸 터치/클릭
      const plot = page.getByTestId("year-month-chart-plot");
      const box = (await plot.boundingBox())!;
      if (touch) await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
      else await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await expect(page.getByTestId("year-month-chart-detail")).toContainText(/2025년 \d+월/);

      // 계절 패턴: 셀
      await press(page.locator('[data-testid="season-heatmap"] [data-testid="heat-cell"][data-kind="ok"]').first());
      await expect(page.getByTestId("season-heatmap-detail")).toContainText("그해 월평균");

      // 생산·출고: 처음부터 가장 비슷한 시차 설명, 표 행으로 다른 시차
      await expect(page.getByTestId("lag-chart-detail")).toContainText("비교:");
      await press(page.getByTestId("lag-chart-table").locator("summary"));
      await press(page.getByTestId("lag-chart-table").locator("tbody tr").nth(1));
      await expect(page.getByTestId("lag-chart-detail")).toContainText("다음 달 비교");

      // 품목 순위: 근거 보기 → 하나만
      await press(page.getByTestId("top-row").nth(1).getByTestId("why-button"));
      await expect(page.getByTestId("why-detail")).toHaveCount(1);
      await press(page.getByTestId("top-row").nth(2).getByTestId("why-button"));
      await expect(page.getByTestId("why-detail")).toHaveCount(1);

      await noHScroll(page);
      // PC 본문 폭은 넓게
      if (!touch) expect((await page.locator("main").boundingBox())!.width).toBeGreaterThan(900);
    });
  });
}
