/**
 * ② 분석 — 390px. 읽기 전용.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

const CODE = process.env.E2E_ANALYSIS_CODE ?? "TM00655";

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "가로 스크롤 없음").toBeLessThanOrEqual(clientWidth);
}

/** 형제 요소끼리 겹치지 않는지 (버튼·축 라벨) */
async function expectNoOverlap(items: Locator, what: string) {
  const boxes = (await items.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })))).filter((b) => b.w > 0);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(overlap, `${what} ${i}·${j} 겹침`).toBe(false);
    }
}

test("연도 버튼: 제목·기간·월별 값·비교 수치가 함께 바뀐다 (390px)", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/analytics");
  const title = page.getByTestId("shipment-title");
  const period = page.getByTestId("shipment-period");
  // 기본값 = 자료가 있는 최신 연도
  await expect(title).toHaveText("2025년 월별 출고량");
  await expect(period).toContainText("전체 거래처 · 정상 출고 · 2025년 1~12월");
  await expect(page.getByTestId("compare-line-0")).toContainText(/^2025년 1~12월 [\d,]+개$/);
  await expect(page.getByTestId("compare-line-1")).toContainText(/^2024년 1~12월 [\d,]+개$/);
  await expect(page.getByTestId("compare-line-2")).toContainText(/^전년 동기간 대비 [+−]\d+\.\d%$/);
  const ticks = page.locator('[data-testid="year-month-chart"] .recharts-cartesian-axis-tick-value');
  await expect(ticks.first()).toBeVisible();
  const labels = (await ticks.allTextContents()).filter((t) => t.endsWith("월"));
  expect(labels).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}월`)); // 가로축 1~12월 고정
  await expectNoOverlap(page.getByTestId("year-buttons").locator("a"), "연도 버튼");
  await expect(page.locator('[data-testid="year-month-chart"] .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveCount(12);
  await expectNoOverlap(page.locator('[data-testid="year-month-chart"] .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value'), "가로축 라벨");
  // 12월 라벨이 잘리지 않음: 라벨 오른쪽 끝이 차트 안
  const chartBox = (await page.getByTestId("year-month-chart").boundingBox())!;
  const lastTick = (await page.locator('[data-testid="year-month-chart"] .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value').last().boundingBox())!;
  expect(lastTick.x + lastTick.width, "12월 라벨이 차트 안").toBeLessThanOrEqual(chartBox.x + chartBox.width);
  await expectNoHorizontalScroll(page);
  const before = await page.getByTestId("compare-line-0").textContent();

  // 연도 전환은 서버 렌더 — dev 서버에 여러 워커가 붙으면 느리므로 주소 변경을 기다린 뒤 넉넉히 확인
  const pick = async (name: string, year: string) => {
    await page.getByTestId("year-buttons").getByRole("link", { name }).click();
    await page.waitForURL((u) => u.searchParams.get("year") === year, { timeout: 60_000 });
  };
  await pick("2024년", "2024");
  await expect(title).toHaveText("2024년 월별 출고량", { timeout: 60_000 });
  await expect(period).toContainText("2024년 1~12월");
  await expect(page.getByTestId("compare-line-0")).toContainText(/^2024년 1~12월/);
  await expect(page.getByTestId("compare-line-1")).toContainText(/^2023년 1~12월/);
  expect(await page.getByTestId("compare-line-0").textContent()).not.toBe(before);

  await pick("2021년", "2021");
  await expect(title).toHaveText("2021년 월별 출고량", { timeout: 60_000 });
  await expect(page.getByTestId("shipment-compare")).toContainText("비교 자료 부족");

  await pick("전체 기간", "all");
  await expect(title).toHaveText("전체 기간 월별 출고량", { timeout: 60_000 });
  await expect(period).toContainText("전체 거래처 · 정상 출고 · 2021-01~2025-12");
  await expect(page.getByTestId("compare-line-2")).toContainText("직전 12개월 대비");
  await expect(page.locator('[data-testid="all-period-chart"] .recharts-reference-line')).toHaveCount(5); // 2021~2025 1월 구분선
  await expect(page.getByTestId("all-period-chart")).toContainText("2023년");
  // 연도 라벨과 세로축 눈금이 겹치지 않음
  const labelsAndTicks = page.locator('[data-testid="all-period-chart"] :is(text.recharts-label, .recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value)');
  expect(await labelsAndTicks.count(), "연도 라벨 5 + 세로축 눈금 + 단위").toBeGreaterThanOrEqual(10);
  await expectNoOverlap(labelsAndTicks, "연도 라벨·세로축 눈금");
  await expectNoHorizontalScroll(page);
});

test("한 달을 누르면(클릭·키보드·표) 차트 바로 아래에 연월·수량·단위 — 마우스를 올리는 툴팁 없음", async ({ page }) => {
  await page.goto("/analytics?year=2025");
  const dots = page.locator('[data-testid="year-month-chart"] .recharts-line-dot');
  await expect(dots).toHaveCount(12);
  const box = (await dots.nth(2).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("month-tooltip")).toHaveCount(0); // 올리기만 하면 아무것도 안 뜬다
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const detail = page.getByTestId("year-month-chart-detail");
  await expect(detail).toContainText("2025년 3월");
  await expect(detail).toContainText(/정상 출고 [\d,]+개/);
  await expect(detail).toContainText("전년 같은 달(2024년 3월)");
  // 키보드: → 로 다음 달
  await page.getByTestId("year-month-chart-plot").focus();
  await page.keyboard.press("ArrowRight");
  await expect(detail).toContainText("2025년 4월");
  // 표로 보기: 같은 값, 행을 눌러도 선택
  await page.getByTestId("year-month-chart-table").locator("summary").click();
  const rows = page.getByTestId("year-month-chart-table").locator("tbody tr");
  await expect(rows).toHaveCount(12);
  await rows.nth(0).click();
  await expect(detail).toContainText("2025년 1월");
  const tableQty = (await rows.nth(0).locator("td").nth(1).innerText()).trim();
  await expect(detail).toContainText(tableQty);
});

test("기존 B2B/B2C 주소도 전체 거래처 기준 — 합계가 같고 유형 필터는 없다", async ({ page }) => {
  const read = async (url: string) => {
    await page.goto(url);
    return [await page.getByTestId("compare-line-0").textContent(), await page.getByTestId("compare-line-1").textContent()];
  };
  const base = await read("/analytics?year=2025");
  expect(await read("/analytics?seg=B2C&year=2025")).toEqual(base);
  expect(await read("/analytics?seg=B2B&year=2025")).toEqual(base);
  await expect(page.getByRole("link", { name: "B2B" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "B2C" })).toHaveCount(0);
});

test("품목: 박스 확인 품목은 박스 환산 — 제목·비교 단위 일치, 분석 기간 표시", async ({ page }) => {
  await page.goto(`/analytics?code=${CODE}&year=2025`);
  await expect(page.getByTestId("shipment-title")).toHaveText("2025년 월별 출고량");
  await expect(page.getByTestId("shipment-section")).toContainText("단위 박스 (1박스");
  await expect(page.getByTestId("compare-line-0")).toContainText(/박스/);
  await expect(page.getByTestId("returns")).toContainText("반품");
  const heat = page.getByTestId("year-heatmap");
  await expect(heat).toContainText("분석 기간");
  await expect(heat.getByRole("rowheader")).toHaveCount(5);
  await expect(page.getByTestId("lag-table").locator("thead th")).toHaveCount(8);
  await expectNoHorizontalScroll(page);
});

test("전체 요약: 연도별 히트맵·시차 상관에 각자 분석 기간", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("year-heatmap")).toContainText("분석 기간 2021-01~2025-12");
  await expect(page.getByTestId("lag-table")).toBeVisible();
  await expect(page.getByTestId("shipment-compare")).toContainText("반품");
  await expectNoHorizontalScroll(page);
});

test("생산 실적 없는 품번: 월별 출고량은 보이고 생산 비교만 불가", async ({ page }) => {
  await page.goto("/analytics?code=AMCP029");
  await expect(page.getByTestId("shipment-title")).toBeVisible();
  await expect(page.getByTestId("not-analyzable")).toContainText("분석 불가");
});

test.describe("간헐 출고 품목", () => {
  test("품목 선택: 막대 차트 + 요약 한 줄 + 간헐 안내(비교 박스 위). 전체 거래처는 선 유지", async ({ page }) => {
    await page.goto("/analytics?code=TR00951&year=2025");
    await expect(page.getByTestId("year-month-chart")).toHaveAttribute("data-kind", "bar");
    await expect(page.getByTestId("item-summary")).toHaveText("2025년 출고 77회 · 거래처 1곳(지평주조) · 출고한 달 4/12");
    const note = page.getByTestId("intermittent-note");
    await expect(note).toHaveText("간헐 출고 품목 — 월별 증감률보다 연간 합계로 비교하세요");
    // 안내가 비교 박스 바로 위
    const noteBox = (await note.boundingBox())!;
    const cmpBox = (await page.getByTestId("shipment-compare").boundingBox())!;
    expect(noteBox.y).toBeLessThan(cmpBox.y);
    await page.getByTestId("year-buttons").getByRole("link", { name: "전체 기간" }).click();
    await expect(page.getByTestId("all-period-chart")).toHaveAttribute("data-kind", "bar");
    await expect(page.getByTestId("item-summary")).toContainText("전체 기간 출고");

    await page.goto("/analytics?year=2025");
    await expect(page.getByTestId("year-month-chart")).toHaveAttribute("data-kind", "line");
    await expect(page.getByTestId("item-summary")).toHaveCount(0);
  });

  test("월말 일괄 기록 품목: 분석과 품목 상세에 안내", async ({ page }) => {
    await page.goto("/analytics?code=AMPT001");
    await expect(page.getByTestId("month-end-note")).toHaveText("월말 일괄 기록 품목 — 실제 출고 시점과 다를 수 있음");
    await page.goto("/stock/AMPT001");
    await expect(page.getByTestId("month-end-note")).toHaveText("월말 일괄 기록 품목 — 실제 출고 시점과 다를 수 있음");
    await page.goto("/stock/TR00951");
    await expect(page.getByTestId("month-end-note")).toHaveCount(0);
  });
});
