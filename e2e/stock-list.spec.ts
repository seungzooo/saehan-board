/**
 * ① 재고 목록·홈 — 390px. 읽기 전용.
 */
import { expect, test, type Page } from "@playwright/test";

const num = async (page: Page, testid: string) => Number(((await page.getByTestId(testid).textContent()) ?? "").replace(/[^0-9]/g, ""));

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(clientWidth);
}

test("홈: 관리 대상 = 확인 + 미확인, 집계 기간·최신 출고일 표시", async ({ page }) => {
  await page.goto("/");
  const managed = await num(page, "count-managed");
  const checked = await num(page, "count-checked");
  const unchecked = await num(page, "count-unchecked");
  expect(managed).toBeGreaterThan(0);
  expect(managed).toBe(checked + unchecked);
  await expect(page.getByTestId("home-balance")).toContainText("✓");
  await expect(page.getByTestId("active-period")).toContainText(/\d{4}-\d{2} ~ \d{4}-\d{2}/);
  await expect(page.getByTestId("active-period")).toContainText(/최신 정상·내수 출고일 \d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId("count-dormant-stock")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("미확인 목록 390px: 품번·3개월 출고량·단위가 보이고 큰 '확인 필요' 문구 없음, 가로 스크롤 없음", async ({ page }) => {
  await page.goto("/stock?view=unchecked");
  const rows = page.getByTestId("list-row");
  await expect(rows.first()).toBeVisible();
  const first = rows.first();
  for (const id of ["row-code", "row-recent-qty"]) {
    const box = await first.getByTestId(id).boundingBox();
    expect(box, `${id} 보임`).not.toBeNull();
    expect(box!.x + box!.width, `${id} 화면 안`).toBeLessThanOrEqual(390);
  }
  await expect(first.getByTestId("row-recent-qty")).toContainText(/(박스|파렛트|필름|포장)$/);
  // 큰 문구(text-2xl 이상)로 된 '확인 필요'가 없어야 한다
  const big = await page.locator("main :is(.text-2xl,.text-3xl,.text-4xl,.text-5xl)", { hasText: "확인 필요" }).count();
  expect(big).toBe(0);
  await expectNoHorizontalScroll(page);
});

test("미확인 목록: 전체 정렬 후 페이지 분할 — 1페이지 마지막 ≥ 2페이지 첫 항목 (3개월 출고량)", async ({ page }) => {
  const qtyOf = async (p: Page, which: "first" | "last") => {
    const loc = p.getByTestId("row-recent-qty");
    const el = which === "first" ? loc.first() : loc.last();
    return Number(((await el.locator("b").textContent()) ?? "0").replace(/,/g, ""));
  };
  await page.goto("/stock?view=unchecked");
  const lastOn1 = await qtyOf(page, "last");
  const firstOn1 = await qtyOf(page, "first");
  expect(firstOn1).toBeGreaterThanOrEqual(lastOn1);
  await page.goto("/stock?view=unchecked&page=2");
  const firstOn2 = await qtyOf(page, "first");
  expect(lastOn1).toBeGreaterThanOrEqual(firstOn2);
});

test("목록 검색은 1페이지로 돌아간다", async ({ page }) => {
  await page.goto("/stock?view=unchecked&page=3");
  const code = ((await page.getByTestId("row-code").first().textContent()) ?? "").trim();
  await page.getByRole("searchbox", { name: "목록에서 품명·품번 찾기" }).fill(code);
  await page.waitForURL((u) => u.searchParams.get("q") === code && !u.searchParams.has("page"));
  await expect(page.getByTestId("row-code").first()).toHaveText(code);
});

test("정확한 품번이 휴면에만 있으면 결과 화면에서 휴면 포함 토글을 안내", async ({ page }) => {
  await page.goto("/stock?view=dormant");
  const code = ((await page.getByTestId("row-code").first().textContent()) ?? "").trim();
  expect(code).not.toBe("");
  await page.goto(`/?q=${encodeURIComponent(code)}`);
  await expect(page.getByTestId("dormant-hint")).toContainText(code);
  await page.getByTestId("dormant-hint").click();
  await page.waitForURL(/dormant=1/);
  await expect(page.getByTestId("dormant-toggle")).toBeChecked();
  // 휴면 품목은 대개 최근 재고 파일에 없어 "재고 미확인" 묶음(접힘) 안에 있다
  const group = page.getByTestId("unchecked-group");
  if (await group.count()) await group.locator("summary").click();
  await expect(page.locator('main a[href^="/stock/"]:visible').first()).toBeVisible();
});
