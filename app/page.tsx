import StockCard from "@/components/StockCard";
import StockSearchBox from "@/components/StockSearchBox";
import { LOW_DAYS_THRESHOLD } from "@/config/stock";
import { getDashboard } from "@/lib/dashboard";
import { formatDateTime, formatShort, isSameSeoulDay } from "@/lib/format";
import { getStockBasis, searchStock } from "@/lib/stock";
import { availableText, BasisLine, daysText } from "@/lib/stockDisplay";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** 첫 화면 = 재고 검색. 검색어가 없으면 대시보드 */
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const basis = await getStockBasis();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-8">
      <StockSearchBox initialQuery={q} />
      <BasisLine basis={basis} />
      {query ? <Results q={query} /> : <Dashboard />}
    </main>
  );
}

async function Results({ q }: { q: string }) {
  const { rows, truncated } = await searchStock(q);
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-base font-semibold">일치하는 품목 없음</p>
        <p className="mt-1 text-sm text-zinc-500">&ldquo;{q}&rdquo; — 품번 일부나 용량(예: 2L)으로 다시 찾아보세요.</p>
      </div>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs text-zinc-500">
        {rows.length}개 품목{truncated && " (상위 50개만 표시 — 검색어를 더 구체적으로)"}
      </p>
      {rows.map((r) => (
        <StockCard key={r.code} row={r} q={q} />
      ))}
    </section>
  );
}

async function Dashboard() {
  const d = await getDashboard();
  const uncheckedPct = d.managed > 0 ? (d.unchecked / d.managed) * 100 : 0;
  const lastAdj = d.lastAdjustmentAt
    ? isSameSeoulDay(d.lastAdjustmentAt, new Date())
      ? formatDateTime(d.lastAdjustmentAt).slice(11)
      : formatShort(d.lastAdjustmentAt)
    : null;
  return (
    <>
      <p className="text-center text-sm text-zinc-500">검색어를 입력하세요</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile href="/stock?all=1" label="관리 대상" value={d.managed} sub="등록된 전체 품목" />
        <Tile href="/stock?checked=1" label="확인됨" value={d.checked} sub="이번 기준재고에 있음" />
        <Tile href="/stock?unchecked=1" label="미확인" value={d.unchecked} tone={d.unchecked > 0 ? "muted" : "normal"} sub="확인 필요" />
        <Tile
          href="/stock?low=1"
          label="곧 소진"
          value={d.lowStockCount}
          tone={d.lowStockCount > 0 ? "warn" : "normal"}
          sub={`확인된 품목 중 ${LOW_DAYS_THRESHOLD}일 이하`}
        />
      </div>

      {/* 미확인 비율 */}
      <Link href="/stock?unchecked=1" className="block rounded-lg border border-zinc-200 p-3 hover:border-blue-400 hover:bg-blue-50/40">
        <div className="num flex justify-between text-xs text-zinc-600">
          <span>
            확인됨 {d.checked.toLocaleString()} ({(100 - uncheckedPct).toFixed(1)}%)
          </span>
          <span>
            미확인 {d.unchecked.toLocaleString()} ({uncheckedPct.toFixed(1)}%)
          </span>
        </div>
        <div
          className="mt-1 flex h-3 w-full gap-0.5 overflow-hidden rounded bg-zinc-100"
          role="img"
          aria-label={`관리 대상 ${d.managed}개 중 미확인 ${d.unchecked}개`}
        >
          {d.checked > 0 && <div className="h-full bg-blue-600" style={{ width: `${100 - uncheckedPct}%` }} />}
          {d.unchecked > 0 && <div className="h-full bg-zinc-300" style={{ width: `${uncheckedPct}%` }} />}
        </div>
        <p className="mt-1 text-xs text-zinc-500">미확인 품목은 최근 재고 파일에 없어 수량 대신 &ldquo;확인 필요&rdquo;로 표시됩니다 →</p>
      </Link>

      {/* 곧 소진 표 */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
          <h2 className="text-base font-semibold">곧 소진 ({LOW_DAYS_THRESHOLD}일 이하)</h2>
          <span className="text-xs text-zinc-500">{d.lowBasisTo ? `출고실적 ${d.lowBasisTo} 기준 최근 30일 일평균` : "출고실적 없음"}</span>
        </div>
        {d.lowRows.length === 0 ? (
          <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">확인된 품목 중 곧 소진 품목이 없습니다.</p>
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
              {d.lowRows.slice(0, 20).map((r) => {
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
                        {availableText(r.stock)}
                      </Link>
                    </td>
                    <td className="px-3 py-0 text-right">
                      <Link href={href} className="block py-3 font-semibold text-orange-700">
                        {daysText(r.days)}
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
          오늘 등록된 변동 <b>{d.todayAdjustments.toLocaleString()}건</b>
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
}: {
  href: string;
  label: string;
  value: number;
  sub?: string;
  tone?: "normal" | "warn" | "muted";
}) {
  const color = tone === "warn" ? "text-orange-600" : tone === "muted" ? "text-zinc-500" : "text-zinc-900";
  return (
    <Link href={href} className="flex min-h-12 min-w-0 flex-col rounded-lg border border-zinc-200 p-3 hover:border-blue-400 hover:bg-blue-50/40">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`num mt-1 text-3xl font-bold ${color}`}>{value.toLocaleString()}</span>
      {sub && <span className="truncate text-xs text-zinc-500">{sub}</span>}
    </Link>
  );
}
