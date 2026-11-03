import StockCard from "@/components/StockCard";
import StockSearchBox from "@/components/StockSearchBox";
import { ACTIVE_MONTHS, LOW_DAYS_THRESHOLD } from "@/config/stock";
import { getHomeSummary, getManagedCodes } from "@/lib/activity";
import { getTodayActivity } from "@/lib/dashboard";
import { formatDateTime, formatShort, isSameSeoulDay } from "@/lib/format";
import { sortRows } from "@/lib/managed";
import { getStockBasis, searchStock } from "@/lib/stock";
import { BasisLine, isDiscontinued } from "@/lib/stockDisplay";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** 첫 화면 = 재고 검색. 검색어가 없으면 대시보드 */
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string; dormant?: string }> }) {
  const { q = "", dormant } = await searchParams;
  const query = q.trim();
  const includeDormant = dormant === "1";
  const basis = await getStockBasis();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-8">
      <StockSearchBox initialQuery={q} includeDormant={includeDormant} />
      {query ? (
        <>
          <BasisLine basis={basis} />
          <Results q={query} includeDormant={includeDormant} />
        </>
      ) : (
        <Dashboard basis={basis} />
      )}
    </main>
  );
}

async function Results({ q, includeDormant }: { q: string; includeDormant: boolean }) {
  const managedCodes = includeDormant ? null : await getManagedCodes();
  const { rows, truncated, hiddenDormant, exactDormant } = await searchStock(q, { managedCodes });
  const withDormant = `/?q=${encodeURIComponent(q)}&dormant=1`;

  const hint =
    exactDormant ? (
      <Link
        href={withDormant}
        data-testid="dormant-hint"
        className="block rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 hover:bg-blue-100"
      >
        품번 <b className="font-mono">{exactDormant.code}</b>({exactDormant.name})은 <b>휴면 품목</b>이라 기본 검색에서 빠졌습니다. &ldquo;휴면 품목 포함&rdquo;으로 보기 →
      </Link>
    ) : hiddenDormant > 0 ? (
      <Link href={withDormant} className="text-sm text-blue-600" data-testid="dormant-hint">
        휴면 품목 {hiddenDormant}개는 숨겨졌습니다 — 휴면 품목 포함으로 보기 →
      </Link>
    ) : null;

  if (rows.length === 0) {
    return (
      <>
        {hint}
        <div className="py-10 text-center">
          <p className="text-base font-semibold">일치하는 품목 없음</p>
          <p className="text-sm text-zinc-500">다른 검색어를 입력하세요.</p>
          <p className="mt-1 text-sm text-zinc-500">
            &ldquo;{q}&rdquo; — 품번 일부나 용량(예: 2L)으로 다시 찾아보세요.{!includeDormant && " 기본 검색은 관리 대상만 찾습니다."}
          </p>
        </div>
      </>
    );
  }
  // 확인된 품목이 위(단종은 그 아래), 확인 필요 품목은 접힌 묶음으로 맨 아래
  const checked = rows.filter((r) => r.stock.available !== null);
  const active = checked.filter((r) => !isDiscontinued(r.name));
  const discontinued = checked.filter((r) => isDiscontinued(r.name));
  const unchecked = rows.filter((r) => r.stock.available === null);
  return (
    <section className="flex flex-col gap-2">
      {hint}
      <p className="num text-xs text-zinc-500">
        {rows.length}개 품목 · 확인됨 {checked.length} · 재고 미확인 {unchecked.length}
        {includeDormant ? " · 휴면 포함" : " · 관리 대상만"}
        {truncated && " (상위 50개만 표시 — 검색어를 더 구체적으로)"}
      </p>
      {[...active, ...discontinued].map((r) => (
        <StockCard key={r.code} row={r} q={q} />
      ))}
      {checked.length === 0 && <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">이번 기준재고에 있는 품목이 없습니다.</p>}
      {unchecked.length > 0 && (
        <details data-testid="unchecked-group" className="rounded-lg border border-dashed border-zinc-400">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 text-sm text-zinc-600 hover:bg-zinc-50">
            <span>
              재고 미확인 <b className="num">{unchecked.length}개</b> — 최근 재고 파일에 없음
            </span>
            <span className="text-xs">펼치기</span>
          </summary>
          <div className="flex flex-col gap-2 p-2">
            {unchecked.map((r) => (
              <StockCard key={r.code} row={r} q={q} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

async function Dashboard({ basis: stockBasis }: { basis: Awaited<ReturnType<typeof getStockBasis>> }) {
  const [{ basis, rows, summary: s }, today] = await Promise.all([getHomeSummary(), getTodayActivity()]);
  const uncheckedPct = s.managed > 0 ? (s.unchecked / s.managed) * 100 : 0;
  const low = sortRows(
    rows.filter((r) => r.managed && r.stock.available !== null && r.days !== null && r.days <= LOW_DAYS_THRESHOLD),
    "low",
  );
  const lastAdj = today.lastAdjustmentAt
    ? isSameSeoulDay(today.lastAdjustmentAt, new Date())
      ? formatDateTime(today.lastAdjustmentAt).slice(11)
      : formatShort(today.lastAdjustmentAt)
    : null;
  return (
    <>
      {/* 재고 기준(집계·반영 시각)과 관리 대상 기준을 한 블록으로 */}
      <div data-testid="active-period" className="num flex flex-col gap-1 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        <BasisLine basis={stockBasis} />
        <p>
          {basis ? (
            <>
              관리 대상 = <b>{basis.fromYm} ~ {basis.basisYm}</b>(최근 {ACTIVE_MONTHS}개 달)에 정상·내수 출고가 있는 품목 · 최신 정상·내수 출고일{" "}
              <b>{basis.latestShipDate}</b>
            </>
          ) : (
            "정상·내수 출고실적이 없어 관리 대상을 정할 수 없습니다."
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="home-counts">
        <Tile href="/stock?view=all" label="관리 대상" value={s.managed} sub={`등록 ${s.registered.toLocaleString()} 중`} testid="count-managed" />
        <Tile href="/stock?view=checked" label="확인" value={s.checked} sub="이번 기준재고에 있음" testid="count-checked" />
        <Tile href="/stock?view=unchecked" label="미확인" value={s.unchecked} tone={s.unchecked > 0 ? "muted" : "normal"} sub="확인 필요" testid="count-unchecked" />
        <Tile href="/stock?view=dormant" label="휴면" value={s.dormant} tone="muted" sub={`최근 ${ACTIVE_MONTHS}개 달 출고 없음`} testid="count-dormant" />
      </div>
      <p className="num text-xs text-zinc-500" data-testid="home-balance">
        관리 대상 {s.managed.toLocaleString()} = 확인 {s.checked.toLocaleString()} + 미확인 {s.unchecked.toLocaleString()}
        {s.balanced ? " ✓" : " — 합계 불일치, 관리자에게 알려 주세요"}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Tile
          href="/stock?view=low"
          label="곧 소진"
          value={s.low}
          tone={s.low > 0 ? "warn" : "normal"}
          sub={`관리 대상 확인 품목 중 ${LOW_DAYS_THRESHOLD}일 이하`}
        />
        <Tile
          href="/stock?view=dormantStock"
          label="휴면이지만 재고 있음"
          value={s.dormantWithStock}
          tone={s.dormantWithStock > 0 ? "warn" : "normal"}
          sub="최근 재고 파일 수량 > 0"
          testid="count-dormant-stock"
        />
      </div>

      {/* 미확인 비율 */}
      <Link href="/stock?view=unchecked" className="block rounded-lg border border-zinc-200 p-3 hover:border-blue-400 hover:bg-blue-50/40">
        <div className="num flex justify-between text-xs text-zinc-600">
          <span>
            확인 {s.checked.toLocaleString()} ({(100 - uncheckedPct).toFixed(1)}%)
          </span>
          <span>
            미확인 {s.unchecked.toLocaleString()} ({uncheckedPct.toFixed(1)}%)
          </span>
        </div>
        <div
          className="mt-1 flex h-3 w-full gap-0.5 overflow-hidden rounded bg-zinc-100"
          role="img"
          aria-label={`관리 대상 ${s.managed}개 중 미확인 ${s.unchecked}개`}
        >
          {s.checked > 0 && <div className="h-full bg-blue-600" style={{ width: `${100 - uncheckedPct}%` }} />}
          {s.unchecked > 0 && <div className="h-full bg-zinc-300" style={{ width: `${uncheckedPct}%` }} />}
        </div>
        <p className="mt-1 text-xs text-zinc-500">관리 대상 중 최근 재고 파일에 없는 품목 — 최근 출고량 많은 순으로 보기 →</p>
      </Link>

      {/* 곧 소진 표 */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
          <h2 className="text-base font-semibold">곧 소진 ({LOW_DAYS_THRESHOLD}일 이하)</h2>
          <span className="num text-xs text-zinc-500">{basis ? `출고실적 ${basis.latestShipDate} 기준 최근 30일 일평균` : "출고실적 없음"}</span>
        </div>
        {low.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">관리 대상 확인 품목 중 곧 소진 품목이 없습니다.</p>
        ) : (
          <table className="num w-full overflow-hidden rounded-lg border border-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">품명</th>
                <th className="px-3 py-2 text-right font-medium">현재 재고</th>
                <th className="px-3 py-2 text-right font-medium">소진</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {low.slice(0, 20).map((r) => {
                const href = `/stock/${encodeURIComponent(r.code)}`;
                return (
                  <tr key={r.code} className="hover:bg-blue-50">
                    <td className="max-w-0 truncate px-3 py-0">
                      <Link href={href} className="block py-3 text-zinc-900">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-0 text-right">
                      <Link href={href} className="block py-3 font-semibold">
                        {r.stock.available!.toLocaleString()}박스
                      </Link>
                    </td>
                    <td className="px-3 py-0 text-right">
                      <Link href={href} className="block py-3 font-semibold text-orange-700">
                        {r.days! >= 10 ? Math.round(r.days!) : Number(r.days!.toFixed(1))}일
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <Link
        href="/adjust"
        className="flex min-h-12 items-center justify-between rounded-lg border border-zinc-200 px-3 hover:border-blue-400 hover:bg-blue-50/40"
      >
        <span className="num text-sm">
          오늘 등록된 변동 <b>{today.todayAdjustments.toLocaleString()}건</b>
          <span className="text-zinc-500"> · {lastAdj ? `마지막 반영 ${lastAdj}` : "변동 없음"}</span>
        </span>
        <span className="text-sm text-blue-600">변동 입력 →</span>
      </Link>
    </>
  );
}

function Tile({
  href,
  label,
  value,
  sub,
  tone = "normal",
  testid,
}: {
  href: string;
  label: string;
  value: number;
  sub?: string;
  tone?: "normal" | "warn" | "muted";
  testid?: string;
}) {
  const color = tone === "warn" ? "text-orange-600" : tone === "muted" ? "text-zinc-500" : "text-zinc-900";
  return (
    <Link href={href} className="flex min-h-12 min-w-0 flex-col rounded-lg border border-zinc-200 p-3 hover:border-blue-400 hover:bg-blue-50/40">
      <span className="text-xs text-zinc-500">{label}</span>
      <span data-testid={testid} className={`num mt-1 text-3xl font-bold ${color}`}>
        {value.toLocaleString()}
      </span>
      {sub && <span className="truncate text-xs text-zinc-500">{sub}</span>}
    </Link>
  );
}
