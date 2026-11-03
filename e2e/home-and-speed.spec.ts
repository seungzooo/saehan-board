/**
 * 홈 버그·속도 관련 동작 — 읽기 전용 (업로드는 미리보기만, 저장 버튼은 누르지 않는다).
 */
import { expect, test, type Page } from "@playwright/test";

const PIN = process.env.UPLOAD_PIN ?? "";

/** 체크박스를 다섯 번 연속으로 누르고, 매번 바로 상태가 맞게 바뀌는지 + 최종 상태가 주소에 남는지 */
async function fiveClicks(page: Page, toggleId: string, labelId: string) {
  const box = page.getByTestId(toggleId);
  const label = page.getByTestId(labelId);
  let expected = await box.isChecked();
  for (let i = 0; i < 5; i++) {
    // 짝수 번째는 체크박스, 홀수 번째는 라벨 글자를 누른다 (라벨을 눌러도 체크되어야 함)
    if (i % 2 === 0) await box.click();
    else await label.getByText("휴면 품목 포함").click();
    expected = !expected;
    // 서버 응답을 기다리지 않고 즉시 반영, 되돌아가지 않음
    if (expected) await expect(box).toBeChecked({ timeout: 1000 });
    else await expect(box).not.toBeChecked({ timeout: 1000 });
  }
  // 최종 상태가 주소에 저장되고, 응답이 끝난 뒤에도 그대로
  await page.waitForURL((u) => (u.searchParams.get("dormant") === "1") === expected, { timeout: 30_000 });
  await expect(page.getByTestId("search-pending").or(page.getByTestId("list-pending"))).toHaveCount(0, { timeout: 30_000 });
  if (expected) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
  // 새로고침해도 유지
  await page.reload();
  if (expected) await expect(page.getByTestId(toggleId)).toBeChecked();
  else await expect(page.getByTestId(toggleId)).not.toBeChecked();
  return expected;
}

for (const width of [390, 1280]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("홈 검색: 휴면 품목 포함 다섯 번 연속 클릭", async ({ page }) => {
      await page.goto("/?q=2L");
      await expect(page.getByTestId("dormant-toggle")).not.toBeChecked();
      expect(await fiveClicks(page, "dormant-toggle", "dormant-label")).toBe(true); // 5번 → 켜짐
      expect(page.url()).toContain("q=2L"); // 검색어는 유지
    });

    test("재고 목록: 휴면 품목 포함 다섯 번 연속 클릭", async ({ page }) => {
      await page.goto("/stock?view=unchecked");
      await expect(page.getByTestId("list-dormant-toggle")).not.toBeChecked();
      expect(await fiveClicks(page, "list-dormant-toggle", "list-dormant-label")).toBe(true);
      expect(page.url()).toContain("view=unchecked");
    });
  });
}

test("홈: 검색어가 없으면 '검색어를 입력하세요' 문구 없음, 빈 결과에서만 안내", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-counts")).toBeVisible();
  await expect(page.getByText("검색어를 입력하세요")).toHaveCount(0);
  await page.goto("/?q=zzzz-없는-품목");
  await expect(page.getByText("일치하는 품목 없음")).toBeVisible();
  await expect(page.getByText("다른 검색어를 입력하세요.")).toBeVisible();
});

test("홈: 재고 기준 줄과 관리 대상 설명이 한 블록", async ({ page }) => {
  await page.goto("/");
  const block = page.getByTestId("active-period");
  await expect(block).toContainText(/집계 시각 미확인|재고 집계 기준|아직 재고 파일이 없습니다/);
  await expect(block).toContainText("관리 대상 =");
});

test("검색 버튼: 누르는 즉시 로딩 표시", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "품목 검색" }).fill("식용유");
  await page.getByTestId("search-button").click();
  await expect(page.getByTestId("search-button")).toHaveAttribute("aria-busy", "true", { timeout: 1000 });
  await page.waitForURL(/q=/);
});

test("분석 연도 버튼: 서버 요청 없이 즉시 바뀌고 주소(?year=)는 갱신", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("shipment-title")).toHaveText("2025년 월별 출고량");
  const requests: string[] = [];
  // 연도 전환이 서버를 부른다면 /analytics 문서나 RSC 요청이 생긴다. 링크 미리 불러오기(prefetch)는 다른 경로라 제외
  page.on("request", (r) => {
    const u = new URL(r.url());
    const prefetch = r.headers()["next-router-prefetch"] !== undefined;
    if (u.pathname === "/analytics" && !prefetch && ["document", "fetch", "xhr"].includes(r.resourceType())) requests.push(r.url());
  });
  for (const [name, title, year] of [
    ["2024년", "2024년 월별 출고량", "2024"],
    ["전체 기간", "전체 기간 월별 출고량", "all"],
    ["2022년", "2022년 월별 출고량", "2022"],
  ] as const) {
    const t0 = Date.now();
    await page.getByTestId("year-buttons").getByRole("link", { name }).click();
    await expect(page.getByTestId("shipment-title")).toHaveText(title, { timeout: 2000 });
    expect(Date.now() - t0, `${name} 전환 시간`).toBeLessThan(1500); // 서버를 거치지 않음 (e2e 오버헤드 포함 여유)
    expect(new URL(page.url()).searchParams.get("year")).toBe(year);
  }
  expect(requests, "연도 버튼은 서버 요청을 만들지 않는다").toEqual([]);
  // 주소로 직접 열어도 같은 연도
  await page.goto("/analytics?year=2022");
  await expect(page.getByTestId("shipment-title")).toHaveText("2022년 월별 출고량");
});

test("분석: 집계 완료 월과 그 값을 정한 업로드 표시", async ({ page }) => {
  await page.goto("/analytics");
  const src = page.getByTestId("completion-source");
  await expect(src).toContainText("집계 완료 2025-12까지");
  await expect(src.getByRole("link")).toHaveAttribute("href", /\/upload\//);
});

test("출고실적 업로드: 2026-03-15까지 있는 파일 → 기본 제안 2026-02 (저장하지 않음)", async ({ page }) => {
  test.skip(!PIN, "UPLOAD_PIN이 설정되지 않음");
  await page.goto("/upload?kind=SALES");
  await page.getByLabel("관리 코드").fill(PIN);
  await page.getByRole("button", { name: "확인" }).click();
  await page.getByRole("tab", { name: "출고실적" }).click();
  const csv =
    "﻿출고일자,전표번호,출고구분,판매형태,품번,품명/규격,거래선,포장단위수량,출고수량\n" +
    "2026-03-02,T1,정상,내수,TM00655,시험,시험거래처,100,200\n" +
    "2026-03-15,T2,정상,내수,TM00655,시험,시험거래처,100,300\n";
  await page.locator('input[type="file"]').setInputFiles({ name: "출고실적_제안확인.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  const field = page.getByTestId("completion-field");
  await expect(field).toContainText("2026-03-15");
  await expect(field).toContainText("기본 제안 2026-02");
  await expect(page.locator("#complete-month")).toHaveValue("2026-02");
  // 담당자가 2026-03으로 바꿀 수 있다 (비교에 포함된다는 안내로 바뀜)
  await page.locator("#complete-month").fill("2026-03");
  await expect(page.locator("#complete-month")).toHaveValue("2026-03");
  await expect(field).toContainText("이 달까지만 씁니다");
});
