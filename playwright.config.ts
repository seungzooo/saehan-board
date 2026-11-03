import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

/**
 * 모바일 e2e. 읽기 전용 — DB에 아무것도 쓰지 않는다.
 *   npm run test:e2e   (dev 서버가 localhost:3000에 떠 있어야 함. 없으면 자동 기동)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/stock",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
