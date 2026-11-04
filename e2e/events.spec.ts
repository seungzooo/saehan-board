/**
 * 주목할 변화 · 거래선 TOP 10 — 읽기 전용 (메모 저장은 누르지 않는다. 열람 사용자 거부만 확인).
 */
import { expect, test, type Page } from "@playwright/test";

async function noHScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("이번 기간에 주목할 변화: 기본 3건, 누르면 실제 수량·평소·기여·일정과 확인할 점", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("question-notable")).toHaveText("이번 기간에 주목할 변화");
  test.skip((await page.getByTestId("notable-empty").count()) > 0, "탐지 결과가 아직 계산되지 않음");
  const items = page.getByTestId("notable-list").getByTestId("event-item");
  await expect(items).toHaveCount(3);
  const title = await items.first().getByTestId("event-title").innerText();
  expect(title).toMatch(/\d{4}년 \d+월/); // 실제 값으로 쓴 제목
  expect(title).toMatch(/[\d,]+개/);
  await items.first().locator("button").first().click();
  const d = page.getByTestId("event-detail");
  await expect(d.getByTestId("ev-baseline")).toContainText("비교");
  await expect(d.getByTestId("ev-checks")).toContainText("원인은 판단하지 않았습니다");
  await expect(d).not.toContainText(/명절 수요 때문|때문에 증가/);
  await expect(d.getByTestId("ev-notes")).toContainText("관리 코드로 들어온 기기에서만"); // 열람 사용자는 메모 불가
  await noHScroll(page);
});

test("전체 보기: 유형·거래처로 찾기", async ({ page }) => {
  await page.goto("/analytics/events");
  test.skip((await page.getByTestId("events-basis").count()) === 0, "탐지 결과가 아직 계산되지 않음");
  const total = Number((await page.getByTestId("events-total").innerText()).match(/^([\d,]+)건/)![1].replace(/,/g, ""));
  expect(total).toBeGreaterThan(3);
  await page.getByLabel("변화 유형").selectOption("STOP,RESUME");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/kind=STOP%2CRESUME/);
  const items = page.getByTestId("events-list").getByTestId("event-item");
  const n = await items.count();
  for (let i = 0; i < Math.min(n, 10); i++) expect(["STOP", "RESUME"]).toContain(await items.nth(i).getAttribute("data-kind"));
});

test("거래선 TOP 10: 순위·거래선·출고량·비중·전년 대비, 누르면 주력 제품 그래프와 탐지된 변화", async ({ page }) => {
  await page.goto("/analytics");
  await page.getByTestId("customer-top-link").click();
  await expect(page).toHaveURL(/\/analytics\/customers/);
  const rows = page.getByTestId("customer-top-row");
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText(/^1/);
  await expect(page.getByTestId("customer-top").locator("thead")).toContainText("전년 대비");
  await page.getByTestId("top-periods").getByRole("link", { name: "2024년" }).click();
  await expect(page.getByTestId("top-meta")).toContainText("2024-01~2024-12");
  await rows.first().getByRole("link").click();
  await expect(page.getByTestId("customer-timeline")).toBeVisible();
  const evs = page.getByTestId("customer-event");
  if ((await evs.count()) > 0) {
    await evs.first().click();
    await expect(page.getByTestId("event-detail")).toBeVisible();
    await expect(page.getByTestId("event-detail")).toContainText("확인할 점");
  }
  await noHScroll(page);
});

test("메모 저장은 관리 코드 필요 — 열람 사용자 화면에는 저장 칸이 없다", async ({ page }) => {
  await page.goto("/analytics/events");
  test.skip((await page.getByTestId("events-basis").count()) === 0, "탐지 결과가 아직 계산되지 않음");
  await page.getByTestId("events-list").getByTestId("event-item").first().locator("button").first().click();
  await expect(page.getByRole("button", { name: "메모 저장" })).toHaveCount(0);
});
