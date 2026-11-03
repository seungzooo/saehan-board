import type { UploadKind } from "@/config/excel-mapping";
import { LOW_DAYS_THRESHOLD } from "@/config/stock";
import { getDashboard } from "@/lib/dashboard";
import { UPLOAD_KIND_LABEL } from "@/lib/excel/upload";
import { formatDateTime, formatShort, isSameSeoulDay } from "@/lib/format";
import { basisText, SampleBadge, StaleBadge } from "@/lib/stockDisplay";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await getDashboard();
  const lastAdj = d.lastAdjustmentAt
    ? isSameSeoulDay(d.lastAdjustmentAt, new Date())
      ? formatDateTime(d.lastAdjustmentAt).slice(11)
      : formatShort(d.lastAdjustmentAt)
    : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">재고보드</h1>
        <p className="mt-1 text-sm text-zinc-600">매일 아침 ERP 재고 엑셀을 올리면 영업팀이 최신 수량을 봅니다.</p>
      </header>

      {/* 재고 기준 */}
      <Link href="/upload" className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 active:bg-zinc-50">
        <span className="text-xs text-zinc-500">재고 기준</span>
        <span className={`mt-1 text-base font-bold ${d.batch ? "text-zinc-900" : "text-red-600"}`}>
          {d.batch ? basisText(d.batch) : "재고 파일 없음"}
          {d.batch && (
            <>
              <StaleBadge uploadedAt={d.batch.uploadedAt} />
              <SampleBadge fileName={d.batch.fileName} />
            </>
          )}
        </span>
      </Link>

      {/* 관리 대상 / 확인 / 미확인 */}
      <div className="grid grid-cols-3 gap-2">
        <Tile href="/stock" label="관리 대상" value={d.managed.toLocaleString()} unit="품목" />
        <Tile href="/stock" label="이번 기준재고 확인" value={d.checked.toLocaleString()} unit="품목" tone="ok" />
        <Tile
          href="/stock?unchecked=1"
          label="미확인"
          value={d.unchecked.toLocaleString()}
          unit="품목"
          tone={d.unchecked > 0 ? "warn" : "normal"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile
          href="/stock?low=1"
          label={`확인된 ${d.checked.toLocaleString()}품목 중 소진 ${LOW_DAYS_THRESHOLD}일 이하`}
          value={d.lowStockCount.toLocaleString()}
          unit="품목"
          tone={d.lowStockCount > 0 ? "warn" : "normal"}
          sub={d.lowBasisTo ? `출고실적 ${d.lowBasisTo} 기준` : "출고실적 없음"}
        />
        <Tile
          href="/adjust"
          label="오늘 등록된 변동"
          value={d.todayAdjustments.toLocaleString()}
          unit="건"
          sub={lastAdj ? `마지막 반영 ${lastAdj}` : "변동 없음"}
        />
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">최근 업로드</h2>
          <Link href="/upload" className="text-sm text-blue-600">
            업로드 →
          </Link>
        </div>
        {d.recentUploads.length === 0 ? (
          <p className="text-sm text-zinc-500">업로드 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {d.recentUploads.map((b) => (
              <li key={b.id}>
                <Link href={`/upload?kind=${b.kind}`} className="flex items-center gap-3 px-3 py-2 active:bg-zinc-50">
                  <span className="w-20 shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-center text-xs font-medium">
                    {UPLOAD_KIND_LABEL[b.kind as UploadKind] ?? b.kind}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {b.fileName}
                    <SampleBadge fileName={b.fileName} />
                  </span>
                  <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(b.uploadedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-3 gap-2 text-center text-sm font-medium">
        <Link href="/stock" className="rounded-lg border border-zinc-200 bg-white py-3">
          재고 조회
        </Link>
        <Link href="/adjust" className="rounded-lg border border-zinc-200 bg-white py-3">
          변동 입력
        </Link>
        <Link href="/upload" className="rounded-lg border border-zinc-200 bg-white py-3">
          엑셀 업로드
        </Link>
      </nav>
    </main>
  );
}

function Tile({
  href,
  label,
  value,
  unit,
  sub,
  tone = "normal",
}: {
  href: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "normal" | "warn" | "ok";
}) {
  const color = tone === "warn" ? "text-red-600" : tone === "ok" ? "text-green-700" : "text-zinc-900";
  return (
    <Link href={href} className="flex min-w-0 flex-col rounded-lg border border-zinc-200 bg-white p-3 active:bg-zinc-50">
      <span className="text-xs leading-tight text-zinc-500">{label}</span>
      <span className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span>}
      </span>
      {sub && <span className="mt-0.5 truncate text-xs text-zinc-500">{sub}</span>}
    </Link>
  );
}
