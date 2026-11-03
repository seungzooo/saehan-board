/**
 * e2e 공통: 열람 코드로 한 번 들어가 쿠키를 저장한다 (모든 화면이 사내 조회 권한으로 보호되므로).
 * 코드 값은 환경변수 VIEW_CODE에서만 읽는다. 저장 파일 e2e/.auth/는 Git 제외.
 */
import { chromium, type FullConfig } from "@playwright/test";
import fs from "node:fs";

export const VIEWER_STATE = "e2e/.auth/viewer.json";

export default async function globalSetup(config: FullConfig) {
  const { baseURL, extraHTTPHeaders } = config.projects[0].use;
  fs.mkdirSync("e2e/.auth", { recursive: true });
  const code = process.env.VIEW_CODE;
  if (!code) {
    fs.writeFileSync(VIEWER_STATE, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }
  const browser = await chromium.launch();
  const page = await browser.newPage({ extraHTTPHeaders });
  await page.goto(`${baseURL}/enter?next=/stock`);
  await page.getByLabel("열람 코드").fill(code);
  await page.getByRole("button", { name: "확인" }).click();
  await page.waitForURL((u) => u.pathname === "/stock", { timeout: 60_000 });
  await page.context().storageState({ path: VIEWER_STATE });
  await browser.close();
}
