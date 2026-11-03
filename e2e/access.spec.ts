/**
 * 사내 조회 권한 — 읽기 전용. 쿠키 없는 새 컨텍스트에서 시작한다.
 * 코드 값은 환경변수(VIEW_CODE, UPLOAD_PIN)에서만 읽는다.
 */
import { expect, test } from "@playwright/test";

const VIEW = process.env.VIEW_CODE ?? "";
const ADMIN = process.env.UPLOAD_PIN ?? "";

test.use({ storageState: { cookies: [], origins: [] } });

test("코드 없이: 홈·재고·분석·상세는 열람 코드 화면으로", async ({ page }) => {
  for (const path of ["/", "/stock?view=all", "/analytics", "/stock/TM00655", "/adjust/1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/enter\?next=/);
    await expect(page.getByTestId("enter-title")).toHaveText("새한프라텍 사내용 · 열람 코드를 입력하세요");
    await expect(page.locator("main")).not.toContainText("현재 재고");
  }
});

test("코드 없이: 데이터 요청(RSC)·서버 액션은 401", async ({ request }) => {
  // RSC 데이터 요청: Next가 rsc 헤더를 proxy 전에 떼어 내므로 입력 화면으로 보내거나(307) 401 — 어느 쪽이든 데이터는 없다
  const rsc = await request.get("/stock?view=all", { headers: { rsc: "1" }, maxRedirects: 0 });
  expect([307, 401]).toContain(rsc.status());
  if (rsc.status() === 307) expect(rsc.headers()["location"]).toContain("/enter");
  expect(await rsc.text()).not.toContain("현재 재고");
  const action = await request.post("/", { headers: { "next-action": "0".repeat(40), "content-type": "text/plain" }, data: "[]", maxRedirects: 0 });
  expect(action.status()).toBe(401);
  const doc = await request.get("/analytics", { maxRedirects: 0 });
  expect(doc.status()).toBe(307);
  expect(doc.headers()["location"]).toContain("/enter");
  // 위조 쿠키도 거부 (서명 검증)
  const forged = await request.get("/stock", { headers: { cookie: "sb_view=9999999999.forged" }, maxRedirects: 0 });
  expect(forged.status()).toBe(307);
});

test("틀린 코드는 거부, 열람 코드면 원래 화면으로 — 수정·업로드는 관리 코드가 따로 필요", async ({ page }) => {
  test.skip(!VIEW, "VIEW_CODE가 설정되지 않음");
  await page.goto("/stock?view=unchecked");
  await page.getByLabel("열람 코드").fill("000000" === VIEW ? "111111" : "000000");
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByTestId("enter-form").getByRole("alert")).toContainText("코드가 맞지 않습니다");
  await page.getByLabel("열람 코드").fill(VIEW);
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page).toHaveURL(/\/stock\?view=unchecked/);
  await expect(page.getByTestId("list-row").first()).toBeVisible();
  // 30일 쿠키
  const c = (await page.context().cookies()).find((x) => x.name === "sb_view")!;
  expect(c.httpOnly).toBe(true);
  expect(c.expires * 1000 - Date.now()).toBeGreaterThan(29 * 86400_000);
  // 열람 사용자: 업로드·변동 입력은 관리자 확인 화면에서 막힌다
  for (const path of ["/upload", "/adjust"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "관리자 확인" })).toBeVisible();
    await expect(page.getByLabel("관리 코드")).toBeVisible();
  }
  // 화면 HTML에 코드 값이 없다
  expect(await page.content()).not.toContain(VIEW);
});

test("관리 코드로도 조회 가능, 업로드 화면까지 바로 열린다", async ({ page }) => {
  test.skip(!ADMIN, "UPLOAD_PIN이 설정되지 않음");
  await page.goto("/");
  await page.getByLabel("열람 코드").fill(ADMIN);
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByTestId("home-counts")).toBeVisible();
  await page.goto("/upload");
  await expect(page.getByRole("tab", { name: "재고" })).toBeVisible();
});
