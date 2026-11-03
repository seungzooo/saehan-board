/**
 * PIN 보호와 중복 품번 미리보기. 읽기 전용 — 저장 버튼은 누르지 않는다 (로컬 .env가 운영과 같은 DB를 쓴다).
 * 각 테스트는 새 브라우저 컨텍스트(쿠키 없음 = 시크릿 창과 같음)에서 시작한다.
 */
import { expect, test } from "@playwright/test";

const PIN = process.env.UPLOAD_PIN ?? "";
const CODE = process.env.E2E_DUP_CODE ?? "TM00655";

test.describe("PIN 보호 (시크릿 상태)", () => {
  for (const path of ["/upload", "/adjust"]) {
    test(`${path}: PIN 없이 열면 PIN 입력을 요구하고 본문은 보이지 않는다`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId("pin-form")).toBeVisible();
      await expect(page.getByLabel("관리 코드")).toBeVisible();
      await expect(page.getByRole("heading", { name: "관리자 확인" })).toBeVisible();
      await expect(page.getByTestId("pin-desc")).toHaveText("재고 업로드와 변동 입력은 생산지원팀만 할 수 있습니다. 관리 코드를 입력하세요.");
      // 내부 용어 노출 금지
      const text = await page.locator("main").innerText();
      for (const word of ["PIN", "UPLOAD_PIN", "공용", "환경변수"]) expect(text, word).not.toContain(word);
      if (path === "/upload") await expect(page.getByRole("tab", { name: "재고" })).toHaveCount(0);
      else await expect(page.getByPlaceholder("품목명 또는 품번")).toHaveCount(0);
    });
  }

  test("조회 화면은 PIN 없이 열린다", async ({ page }) => {
    for (const path of ["/", "/stock?unchecked=1", "/analytics"]) {
      await page.goto(path);
      await expect(page.getByTestId("pin-form")).toHaveCount(0);
    }
  });

  test("틀린 PIN은 거부, 맞는 PIN이면 열리고 다른 보호 화면도 열린다", async ({ page }) => {
    test.skip(!PIN, "UPLOAD_PIN이 설정되지 않음");
    await page.goto("/upload");
    await page.getByLabel("관리 코드").fill("000000" === PIN ? "111111" : "000000");
    await page.getByRole("button", { name: "확인" }).click();
    await expect(page.getByTestId("pin-form").getByRole("alert")).toContainText("관리 코드가 맞지 않습니다");

    await page.getByLabel("관리 코드").fill(PIN);
    await page.getByRole("button", { name: "확인" }).click();
    await expect(page.getByRole("tab", { name: "재고" })).toBeVisible();

    await page.goto("/adjust");
    await expect(page.getByTestId("pin-form")).toHaveCount(0);
    await expect(page.getByPlaceholder("품목명 또는 품번")).toBeVisible();
  });
});

test("같은 품번 두 줄 재고 파일 → 미리보기에 '중복 품번 1개' (저장하지 않음)", async ({ page }) => {
  test.skip(!PIN, "UPLOAD_PIN이 설정되지 않음");
  await page.goto("/upload");
  await page.getByLabel("관리 코드").fill(PIN);
  await page.getByRole("button", { name: "확인" }).click();
  await expect(page.getByRole("tab", { name: "재고" })).toBeVisible();

  const csv = `﻿품번,재고수량\n${CODE},40\n${CODE},60\n`;
  await page.locator('input[type="file"]').setInputFiles({ name: "중복테스트.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByTestId("dup-codes")).toContainText("중복 품번 1개");
  await expect(page.getByText(`중복 품번: ${CODE}`).first()).toBeAttached();
});
