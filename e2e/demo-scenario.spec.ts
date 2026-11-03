/**
 * 업무 시나리오 — DB에 쓰는 e2e (샘플 시나리오 검증, 회사 실재고 아님). **분리 스키마(DATABASE_SCHEMA=demo)로 띄운 서버에서만** 돈다.
 *   1) DATABASE_SCHEMA=demo npx tsx scripts/demo-schema.ts        (스키마 초기화 + 시연 품목·거래처·출고실적)
 *   2) 그 스키마로 서버를 띄우고 E2E_DEMO=1 E2E_BASE_URL=… npx playwright test e2e/demo-scenario.spec.ts
 * 운영(public) 서버에는 시연 품목이 없으므로, 첫 단계에서 품명이 실제로 보이는지 확인하고 아니면 아무것도 쓰지 않고 멈춘다.
 * 코드 값은 환경변수(VIEW_CODE, UPLOAD_PIN)에서만 읽는다.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const PIN = process.env.UPLOAD_PIN ?? "";
const VIEW = process.env.VIEW_CODE ?? "";
test.skip(!process.env.E2E_DEMO, "E2E_DEMO=1 이고 분리 스키마로 띄운 서버에서만 실행");
test.describe.configure({ mode: "serial" });

/** 서울 시각 datetime-local 문자열. offsetMin만큼 이동 */
function seoulLocal(offsetMin = 0): string {
  return new Date(Date.now() + 9 * 3600_000 + offsetMin * 60_000).toISOString().slice(0, 16);
}
/** 다음 분이 될 때까지 기다린다 — 집계 시각(분 단위)이 직전에 입력한 불량보다 늦도록. 입력칸 max(지금)를 넘지 않게 미래 시각은 쓰지 않는다 */
async function waitNextMinute(page: Page) {
  await page.waitForTimeout(60_000 - (Date.now() % 60_000) + 1500);
}
const shown = (local: string) => local.replace("T", " ");

const csv = (rows: [string, string, number][]) => "품번,품명/규격,재고수량\n" + rows.map((r) => r.join(",")).join("\n") + "\n";
const FULL = csv([
  ["DEMO-E", "시연용 낱개 캡", 120],
  ["DEMO-A", "시연용 PET 2L", 90],
  ["DEMO-B", "시연용 PE 1L", 40],
  ["DEMO-Z", "시연용 재고0 용기", 0],
]);

async function unlock(page: Page) {
  await page.goto("/upload");
  if (await page.getByTestId("pin-form").isVisible()) {
    await page.getByLabel("관리 코드").fill(PIN);
    await page.getByRole("button", { name: "확인" }).click();
  }
  await expect(page.getByRole("tab", { name: "재고" })).toBeVisible();
}

async function uploadStock(page: Page, body: string, name: string, opts: { asOf: string; defect: boolean; partial?: boolean }) {
  await unlock(page);
  await page.getByRole("tab", { name: "재고" }).click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from("﻿" + body, "utf8") });
  await expect(page.getByText("누락 품목 처리")).toBeVisible();
  await page.getByLabel("집계 기준 시각").fill(opts.asOf);
  await page.getByText(opts.defect ? "예 — 이전 불량 차감 리셋" : "아니오 — 불량 차감 유지").click();
  if (opts.partial) await page.getByText("일부 갱신", { exact: true }).click();
}

/** 다른 기기와 같은 독립 세션: 쿠키 없는 새 컨텍스트에서 열람 코드로 들어간다 */
async function viewerSession(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto("/stock/customers");
  await expect(page.getByTestId("enter-title")).toBeVisible();
  await page.getByLabel("열람 코드").fill(VIEW);
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page).toHaveURL(/\/stock\/customers/);
  return page;
}

async function demoQty(page: Page, code: string) {
  await page.goto(`/stock/${code}`);
  return page.getByTestId("available");
}

test.beforeAll(async ({ browser }) => {
  test.skip(!PIN || !VIEW, "UPLOAD_PIN·VIEW_CODE가 설정되지 않음");
  // 안전장치: 상태 코드는 믿지 않는다(스트리밍 응답은 없는 품목도 200). 시연 품목 품명이 실제로 보여야 진행
  const page = await browser.newPage({ storageState: "e2e/.auth/viewer.json" });
  await page.goto("/stock/DEMO-E");
  const isDemo = await page.getByRole("heading", { name: "시연용 낱개 캡" }).isVisible({ timeout: 15_000 }).catch(() => false);
  expect(isDemo, "시연 품목이 없는 서버 — 분리 스키마로 띄운 서버가 아니면 쓰지 않는다").toBe(true);
  await page.close();
});

test("오늘 자료 미반영: 이틀 전 집계 파일이면 마지막 확인 수량·시각은 보이고 판정은 보류", async ({ page }) => {
  const old = seoulLocal(-48 * 60);
  await uploadStock(page, csv([["DEMO-E", "시연용 낱개 캡", 50]]), "재고_이틀전.csv", { asOf: old, defect: false });
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();
  await page.goto("/stock/DEMO-E");
  await expect(page.getByTestId("stock-summary")).toContainText("오늘 자료 미반영");
  await expect(page.getByTestId("stale-note")).toBeVisible();
  await expect(page.getByTestId("available")).toHaveText(/^50\s*박스$/);
  await page.getByTestId("request-qty").fill("100");
  await expect(page.getByTestId("request-result")).toHaveAttribute("data-kind", "HOLD");
  await expect(page.getByTestId("request-result")).toHaveText(`요청 100개 · 마지막 확인 50개 · 집계 ${shown(old)} · 오늘 자료 미반영 — 판정 보류`);
});

test("기초 120 → 불량 30 → 다른 세션에서 거래처 검색 → 100개 요청 → 현재 90개 · 10개 부족", async ({ page, browser }) => {
  const asOf = seoulLocal(-10); // 10분 전 집계 — 불량은 그 뒤에 입력
  // 이틀 전 파일보다 늦은 시각이므로 받는다
  await uploadStock(page, FULL, "재고_기초.csv", { asOf, defect: false });
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();

  // 생산지원팀: 불량 30 입력 (한 번만)
  await page.goto("/adjust?code=DEMO-E");
  await page.locator("#qty").fill("30");
  await page.getByRole("radio", { name: "불량" }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("90");

  // 영업 담당자: 다른 기기(독립 세션) — 열람 코드로 들어와 거래처 검색
  const sales = await viewerSession(browser);
  await sales.getByRole("searchbox", { name: "거래처 검색" }).fill("시연");
  await sales.getByRole("button", { name: "찾기" }).click();
  await sales.getByTestId("customer-hit").first().click();
  await expect(sales.getByTestId("customer-name")).toHaveText("시연거래처");
  await expect(sales.getByTestId("customer-period")).toContainText("2025-01 ~ 2025-12");
  const rowE = sales.locator('[data-testid="customer-item"][data-code="DEMO-E"]');
  await expect(rowE.getByTestId("customer-item-qty")).toHaveText("90개");
  await expect(rowE.getByTestId("customer-item-asof")).toHaveText(`집계 ${shown(asOf).slice(5)}`);
  // 재고 0은 '재고 없음', 파일에 없으면 아래 '확인 필요' 묶음
  await expect(sales.locator('[data-testid="customer-item"][data-code="DEMO-Z"]')).toContainText("재고 없음");
  await expect(sales.getByTestId("customer-unchecked").locator('[data-code="DEMO-U"]')).toContainText("확인 필요");

  // 상세: 목록과 같은 수량·기준 시각, 100개 요청 → 10개 부족
  await rowE.click();
  await expect(sales.getByTestId("available-units")).toHaveText("= 90개");
  await expect(sales.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${shown(asOf)}`);
  await sales.getByTestId("request-qty").fill("100");
  await expect(sales.getByTestId("request-result")).toHaveText("요청 100개 · 현재 90개 · 10개 부족");
  await expect(sales.getByRole("radio", { name: "박스" })).toBeDisabled(); // 박스 입수 없음 → 개 단위만
  await expect(sales.getByTestId("copy-text")).toHaveText(
    `[새한프라텍 재고 확인] 시연용 낱개 캡 (DEMO-E)\n요청 100개 · 현재 90개 · 10개 부족\n재고 집계 기준 ${shown(asOf)} · 확인 재고 기준 (출고 예약·납기 미확정)`,
  );

  // 개↔박스 환산 (DEMO-A: 1박스당 100개, 현재 90박스)
  await sales.goto("/stock/DEMO-A?customer=" + encodeURIComponent("시연거래처"));
  await expect(sales.getByTestId("available-units")).toHaveText("= 9,000개 (90박스)");
  await sales.getByRole("radio", { name: "박스" }).click();
  await sales.getByTestId("request-qty").fill("95");
  await expect(sales.getByTestId("request-result")).toHaveText("요청 9,500개 (95박스) · 현재 9,000개 (90박스) · 500개 (5박스) 부족");
  await sales.getByRole("radio", { name: "개" }).click();
  await sales.getByTestId("request-qty").fill("9500");
  await expect(sales.getByTestId("request-result")).toHaveText("요청 9,500개 (95박스) · 현재 9,000개 (90박스) · 500개 (5박스) 부족");

  // 열람 사용자는 수정·업로드 불가
  for (const path of ["/adjust?code=DEMO-E", "/upload"]) {
    await sales.goto(path);
    await expect(sales.getByRole("heading", { name: "관리자 확인" })).toBeVisible();
    await expect(sales.locator("#qty")).toHaveCount(0);
  }
  await sales.context().close();

  // 같은 파일·같은 설정 재업로드 → 저장되지 않고 여전히 90
  await uploadStock(page, FULL, "재고_기초.csv", { asOf, defect: false });
  await expect(page.getByTestId("preview-same-file")).toBeVisible();
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByText("같은 파일을 같은 설정으로 이미 반영했습니다")).toBeVisible();
  await expect(await demoQty(page, "DEMO-E")).toHaveText(/^90\s*박스$/);
});

test("다음 기초재고가 이미 불량을 반영한 90개 → 미리보기 근거 확인 후 '예' → 90 (60으로 떨어지지 않음)", async ({ page }) => {
  test.setTimeout(150_000);
  await waitNextMinute(page);
  const asOf = seoulLocal(0); // 불량 입력 뒤의 ERP 집계
  await uploadStock(
    page,
    csv([
      ["DEMO-E", "시연용 낱개 캡", 90],
      ["DEMO-A", "시연용 PET 2L", 90],
      ["DEMO-B", "시연용 PE 1L", 40],
      ["DEMO-Z", "시연용 재고0 용기", 0],
    ]),
    "재고_다음.csv",
    { asOf, defect: true },
  );
  const pending = page.getByTestId("pending-defects");
  await expect(pending).toContainText("불량 1건 · 30박스");
  await expect(pending).toContainText("직전 기준 120 − 불량 30");
  await expect(pending).toContainText("불량을 뺀 수량과 같음");
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();
  await expect(await demoQty(page, "DEMO-E")).toHaveText(/^90\s*박스$/);
  await expect(page.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${shown(asOf)}`);
});

test("과거 파일: 현재 기준보다 이전 집계 시각의 파일은 저장하지 않고 수량 유지", async ({ page }) => {
  await uploadStock(page, csv([["DEMO-E", "시연용 낱개 캡", 120]]), "재고_과거.csv", { asOf: seoulLocal(-24 * 60), defect: false });
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByText(/이전 시각(.+)의 재고 파일입니다/)).toBeVisible();
  await expect(await demoQty(page, "DEMO-E")).toHaveText(/^90\s*박스$/);
});

test("일부 갱신(DEMO-A만): A는 새 집계 시각, B는 이전 수량·집계 시각 유지", async ({ page }) => {
  const prevAsOf = await (async () => {
    await page.goto("/stock/DEMO-B");
    return ((await page.getByTestId("stock-summary").innerText()).match(/재고 집계 기준 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/) ?? [])[1];
  })();
  test.setTimeout(150_000);
  await waitNextMinute(page); // 직전 기준(분 단위)보다 늦은 집계 시각
  const asOf2 = seoulLocal(0);
  await uploadStock(page, csv([["DEMO-A", "시연용 PET 2L", 70]]), "재고_일부.csv", { asOf: asOf2, defect: false, partial: true });
  await page.getByRole("button", { name: "일부 갱신으로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();
  await expect(await demoQty(page, "DEMO-A")).toHaveText(/^70\s*박스$/);
  await expect(page.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${shown(asOf2)}`);
  await expect(await demoQty(page, "DEMO-B")).toHaveText(/^40\s*박스$/);
  await expect(page.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${prevAsOf}`);
});
