/**
 * 시연 시나리오 — DB에 쓰는 e2e. **분리 스키마(DATABASE_SCHEMA=demo)로 띄운 서버에서만** 돈다.
 *   1) DATABASE_SCHEMA=demo npx tsx scripts/demo-schema.ts        (스키마 초기화 + 시연 품목 DEMO-A·DEMO-B)
 *   2) 그 스키마로 서버를 띄우고 E2E_DEMO=1 E2E_BASE_URL=… npx playwright test e2e/demo-scenario.spec.ts
 * 운영(public) 서버에는 DEMO-A 품목이 없으므로, 첫 단계에서 그것을 확인하고 아니면 아무것도 쓰지 않고 멈춘다.
 */
import { expect, test, type Page } from "@playwright/test";

const PIN = process.env.UPLOAD_PIN ?? "";
test.skip(!process.env.E2E_DEMO, "E2E_DEMO=1 이고 분리 스키마로 띄운 서버에서만 실행");
test.describe.configure({ mode: "serial" });

/** 서울 날짜 YYYY-MM-DD (지금이 09:05 전이면 어제 — 집계 09:00 이후에 불량을 넣어야 하므로) */
function demoDay(): string {
  const now = new Date(Date.now() + 9 * 3600_000);
  if (now.getUTCHours() < 9 || (now.getUTCHours() === 9 && now.getUTCMinutes() < 5)) now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}
const DAY = demoDay();
const AS_OF = `${DAY}T09:00`; // datetime-local 값
const FILE_FULL = "품번,품명/규격,재고수량\nDEMO-A,시연용 PET 2L,90\nDEMO-B,시연용 PE 1L,40\n";

async function unlock(page: Page) {
  await page.goto("/upload");
  if (await page.getByTestId("pin-form").isVisible()) {
    await page.getByLabel("관리 코드").fill(PIN);
    await page.getByRole("button", { name: "확인" }).click();
  }
  await expect(page.getByRole("tab", { name: "재고" })).toBeVisible();
}

async function uploadStock(page: Page, csv: string, name: string, opts: { asOf: string; defect: boolean; partial?: boolean }) {
  await unlock(page);
  await page.getByRole("tab", { name: "재고" }).click();
  await page.locator('input[type="datetime-local"]').fill(opts.asOf);
  await page.getByText(opts.defect ? "예 — 이전 불량 차감 리셋" : "아니오 — 불량 차감 유지").click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from("\uFEFF" + csv, "utf8") });
  await expect(page.getByText("누락 품목 처리")).toBeVisible();
  if (opts.partial) await page.getByText("일부 갱신", { exact: true }).click();
  return page;
}

test.beforeAll(async ({ browser }) => {
  test.skip(!PIN, "UPLOAD_PIN이 설정되지 않음");
  // 안전장치: 시연 품목이 있는 서버(분리 스키마)인지 먼저 확인
  const page = await browser.newPage({ storageState: "e2e/.auth/viewer.json" });
  // 상태 코드는 믿지 않는다 — 스트리밍 응답은 없는 품목(404 화면)도 200으로 온다. 품명이 실제로 보여야 진행
  await page.goto("/stock/DEMO-A");
  const isDemo = await page.getByRole("heading", { name: "시연용 PET 2L" }).isVisible({ timeout: 15_000 }).catch(() => false);
  expect(isDemo, "시연 품목 DEMO-A가 없는 서버 — 분리 스키마로 띄운 서버가 아니면 쓰지 않는다").toBe(true);
  await page.close();
});

test("재고 90(집계 09:00) → 불량 5 → 같은 파일을 '불량 반영됨'으로 다시 반영 → 85박스 · 집계 09:00", async ({ page }) => {
  // 1) 09:00 집계 재고 파일 (사후 불량 미반영)
  await uploadStock(page, FILE_FULL, "재고_0900.csv", { asOf: AS_OF, defect: false });
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();

  // 2) 불량 5박스 입력 (집계 09:00 이후)
  await page.goto("/adjust?code=DEMO-A");
  await page.locator("#qty").fill("5");
  await page.getByRole("radio", { name: "불량" }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("85");

  // 3) 같은 파일을 "사후 불량 반영됨"으로 다시 반영 — 같은 파일 안내는 나오지만 저장은 된다
  await uploadStock(page, FILE_FULL, "재고_0900.csv", { asOf: AS_OF, defect: true });
  await expect(page.getByTestId("preview-same-file")).toBeVisible();
  await page.getByRole("button", { name: "전체 교체로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();

  // 4) 상세: 85박스, 집계 09:00 (09:05 불량은 09:00 파일에 없으므로 그대로 차감)
  await page.goto("/stock/DEMO-A");
  await expect(page.getByTestId("available")).toHaveText(/^85\s*박스$/);
  await expect(page.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${DAY} 09:00`);
  await expect(page.getByTestId("allocation-note")).toHaveText("다른 거래처 배정분 반영 여부는 생산지원팀 확인");
  const text = await page.locator("main").innerText();
  expect(text).not.toContain("가용재고");
});

test("일부 갱신(DEMO-A만): A는 새 집계 시각, B는 이전 수량·09:00 유지 — 상세·목록·검색", async ({ page }) => {
  // 새 집계 시각 = 지금(분 단위). 09:00 이후여야 하므로 시연일 기준으로 지금 또는 그날 23:59
  const nowSeoul = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
  const asOf2 = nowSeoul.slice(0, 10) === DAY ? nowSeoul : `${DAY}T23:59`;
  const hhmm2 = asOf2.slice(11, 16);
  await uploadStock(page, "품번,품명/규격,재고수량\nDEMO-A,시연용 PET 2L,70\n", "재고_일부.csv", { asOf: asOf2, defect: false, partial: true });
  await page.getByRole("button", { name: "일부 갱신으로 저장" }).click();
  await expect(page.getByTestId("upload-saved")).toBeVisible();

  await page.goto("/stock/DEMO-A");
  await expect(page.getByTestId("available")).toHaveText(/^65\s*박스$/); // 70 − 불량 5 (이 파일은 사후 불량 미반영이라 앞서 넣은 불량은 계속 차감)
  await expect(page.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${DAY} ${hhmm2}`);
  await page.goto("/stock/DEMO-B");
  await expect(page.getByTestId("available")).toHaveText(/^40\s*박스$/);
  await expect(page.getByTestId("stock-summary")).toContainText(`재고 집계 기준 ${DAY} 09:00`);

  // 목록(시연 품목은 출고 이력이 없어 휴면) — 행마다 집계 시각
  const md = DAY.slice(5);
  await page.goto("/stock?view=dormant&q=시연용");
  await expect(page.getByTestId("list-row").filter({ hasText: "DEMO-A" }).getByTestId("row-asof")).toHaveText(`집계 ${md} ${hhmm2}`);
  await expect(page.getByTestId("list-row").filter({ hasText: "DEMO-B" }).getByTestId("row-asof")).toHaveText(`집계 ${md} 09:00`);
  await expect(page.getByTestId("basis-partial")).toBeVisible();

  // 검색 결과 카드
  await page.goto("/?q=시연용&dormant=1");
  await expect(page.locator("a", { hasText: "시연용 PET 2L" }).getByTestId("card-asof")).toHaveText(`집계 ${md} ${hhmm2}`);
  await expect(page.locator("a", { hasText: "시연용 PE 1L" }).getByTestId("card-asof")).toHaveText(`집계 ${md} 09:00`);
});
