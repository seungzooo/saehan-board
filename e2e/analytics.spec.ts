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
  await expect(heat.getByTestId("heat-year")).toHaveCount(5);
  await expect(page.getByTestId("lag-table").locator("thead th")).toHaveCount(8); // 시차 + 같은 달~6개월 뒤 (계산 기준 안)
  await expectNoHorizontalScroll(page);
});

test("전체 요약: 연도별 히트맵·시차 상관에 각자 분석 기간", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("meta-season")).toContainText("분석 기간 2021-01~2025-12");
  await page.getByTestId("lag-criteria").locator("summary").click();
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

test("[전체 기간]에만 연도별 정상 출고 합계 + 전년 대비 증가율", async ({ page }) => {
  await page.goto("/analytics?year=2025");
  await expect(page.getByTestId("yearly-totals")).toHaveCount(0);
  await page.getByTestId("year-buttons").getByRole("link", { name: "전체 기간" }).click();
  const yt = page.getByTestId("yearly-totals");
  await expect(yt).toBeVisible();
  await yt.getByTestId("yearly-chart-table").locator("summary").click();
  const rows = yt.getByTestId("yearly-chart-table").locator("tbody tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(0)).toContainText("2021년");
  await expect(rows.nth(4)).toContainText(/2025년.*1~12월.*[+−]\d+%/);
  await rows.nth(4).click();
  await expect(yt.getByTestId("yearly-chart-detail")).toContainText(/2025년 \(1~12월\)/);
  await expect(yt.getByTestId("yearly-chart-detail")).toContainText(/전년 [\d,]+개 대비 [+−]\d+%/);
});

test("계절 패턴: 셀에 월평균 대비 %, 누르면 실제 출고·그해 월평균·차이", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("question-season")).toHaveText("어느 달에 평소보다 많이 출고됐나?");
  const cells = page.getByTestId("season-heatmap").getByTestId("heat-cell");
  await expect(cells).toHaveCount(60);
  const okCell = page.locator('[data-testid="season-heatmap"] [data-testid="heat-cell"][data-kind="ok"]').first();
  await expect(okCell).toHaveText(/^[+−]\d+%$/);
  await okCell.click();
  const d = page.getByTestId("season-heatmap-detail");
  await expect(d).toContainText(/실제 출고 [\d,]+개 · 그해 월평균 [\d,]+개 · 차이 [+−][\d,]+개 \([+−]\d+%\)/);
  // 키보드: 셀에 포커스 후 Enter
  await cells.nth(5).focus();
  await page.keyboard.press("Enter");
  await expect(d).toContainText("2021년 6월");
});

test("품목 TOP 10: 근거 보기(연도별 출고·그해 월평균·평균 초과 연도 수)와 재고 칸이 품목 상세와 같은 값", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/analytics");
  await expect(page.getByTestId("question-top")).toHaveText("특정 달에 출고가 몰리는 품목은?");
  const rows = page.getByTestId("top-row");
  await expect(rows).toHaveCount(10);
  await rows.first().getByTestId("why-button").click();
  const why = page.getByTestId("why-detail");
  await expect(why).toContainText("평소 = 분석 기간 전체의 월평균");
  await expect(why).toContainText(/평균을 넘은 연도 \d \/ 비교 가능한 연도 \d/);
  await expect(page.getByTestId("why-detail")).toHaveCount(1); // 하나만 펼침
  // 재고 칸 ↔ 품목 상세 대조 (품번 기준)
  const checks: { code: string; state: string; text: string }[] = [];
  for (let i = 0; i < 10; i++) {
    const r = rows.nth(i);
    checks.push({ code: (await r.getAttribute("data-code"))!, state: (await r.getByTestId("stock-cell").getAttribute("data-state"))!, text: await r.getByTestId("stock-cell").innerText() });
  }
  for (const c of checks) {
    await page.goto(`/stock/${encodeURIComponent(c.code)}`);
    const avail = (await page.getByTestId("available").innerText()).replace(/\s+/g, "");
    if (c.state === "CHECK") expect(avail, c.code).toBe("확인필요");
    else expect(c.text.replace(/\s+/g, ""), c.code).toContain(avail.replace("박스", "") + "박스");
  }
});

test("생산·출고 관계: 같은 달/다음 달 … 막대를 누르면 비교 대상과 결과 문장, 계수는 계산 기준 안", async ({ page }) => {
  await page.goto("/analytics");
  await expect(page.getByTestId("question-lag")).toHaveText("생산이 많았던 달에는 출고도 많았을까?");
  await expect(page.getByTestId("answer-lag")).toContainText("월별 합계 기준이며 개별 로트의 출고 시점은 아님");
  await expect(page.getByTestId("answer-lag")).not.toContainText("r=");
  const ticks = page.locator('[data-testid="lag-chart"] .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value');
  await expect(ticks.first()).toHaveText("같은 달");
  await expect(ticks.nth(1)).toHaveText("다음 달");
  await expect(ticks.nth(2)).toHaveText("2개월 뒤");
  await page.getByTestId("lag-chart-table").locator("summary").click();
  await page.getByTestId("lag-chart-table").locator("tbody tr").nth(2).click();
  const d = page.getByTestId("lag-chart-detail");
  await expect(d).toContainText("2개월 뒤 비교");
  await expect(d).toContainText("비교: 생산량(생산한 달) ↔ 그 2개월 뒤 출고량");
  await expect(d).toContainText("결과: 생산이 많았던 달에는 2개월 뒤 출고도");
  await expect(d).toContainText("출고일이나 납기를 정할 수 없습니다");
});

test("산정 불가·확인 필요를 누르면 그 품목의 이유와 다음 행동", async ({ page }) => {
  await page.goto("/analytics");
  const cell = page.getByTestId("top-row").first().getByTestId("stock-cell");
  const state = await cell.getAttribute("data-state");
  await cell.click();
  const d = page.getByTestId("stock-detail");
  await expect(d).toBeVisible();
  if (state === "CHECK") {
    await expect(d.getByRole("link", { name: "재고 확인 필요 → 품목 상세" })).toBeVisible();
    await expect(cell).not.toContainText("산정 불가"); // 같은 이유로 경고를 반복하지 않음
  } else {
    await expect(cell).toContainText(/박스/);
    await expect(cell).toContainText(/집계 \d{2}-\d{2} \d{2}:\d{2}/);
  }
  // 품목 분석 상단 (TR00951: 간헐 출고 품목)
  await page.goto("/analytics?code=TR00951");
  const reason = page.getByTestId("days-reason");
  if ((await reason.count()) > 0) {
    await reason.locator("summary").click();
    await expect(reason.getByRole("link").first()).toHaveText(/재고 확인 필요 → 품목 상세|비교 기간 출고 없음 → 출고 이력/);
  }
});

test("업계 비교 영역: 자료가 없으면 업로드 안내(관리 코드 보호 탭), 원인 단정 표현 없음", async ({ page }) => {
  await page.goto("/analytics");
  const sec = page.getByTestId("section-industry");
  await expect(page.getByTestId("question-industry")).toHaveText("업계 흐름과 같은 방향이었나?");
  await expect(sec).toContainText("C222");
  if ((await page.getByTestId("industry-empty").count()) > 0) {
    await expect(sec.getByRole("link", { name: /업계 지수 올리기/ })).toHaveAttribute("href", "/upload?kind=INDUSTRY");
  } else {
    await expect(page.getByTestId("industry-basis")).toContainText("업종 코드 C222");
  }
  await expect(sec).not.toContainText(/시장 요인|자사 요인/);
  // 업로드 화면 탭은 관리 코드로 보호
  await page.goto("/upload?kind=INDUSTRY");
  await expect(page.getByRole("heading", { name: "관리자 확인" })).toBeVisible();
});
