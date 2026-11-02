import type { UploadKind } from "@/config/excel-mapping";
import { getDashboard, LOW_STOCK_THRESHOLD } from "@/lib/dashboard";
import { UPLOAD_KIND_LABEL } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await getDashboard();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <header>
        <h1 className="text-xl font-bold">재고보드</h1>
        <p className="mt-1 text-sm text-zinc-600">매일 아침 ERP 재고 엑셀을 올리면 영업팀이 최신 수량을 봅니다.</p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Tile href="/upload" label="재고 기준 시각" value={d.batch ? formatDateTime(d.batch.uploadedAt) : "업로드 없음"} small={!!d.batch} tone={d.batch ? "normal" : "warn"} />
        <Tile href="/stock" label="등록 품목" value={d.productCount.toLocaleString()} unit="개" />
        <Tile href="/adjust" label="오늘 변동" value={d.todayAdjustments.toLocaleString()} unit="건" />
        <Tile
          href="/stock?low=1"
          label={`재고 ${LOW_STOCK_THRESHOLD}박스 이하`}
          value={d.lowStockCount.toLocaleString()}
          unit="품목"
          tone={d.lowStockCount > 0 ? "warn" : "normal"}
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
                  <span className="min-w-0 flex-1 truncate">{b.fileName}</span>
                  <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(b.uploadedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-3 gap-2 text-center text-sm font-medium">
        <Link href="/stock" className="rounded-lg border border-zinc-200 bg-white py-3">재고 조회</Link>
        <Link href="/adjust" className="rounded-lg border border-zinc-200 bg-white py-3">변동 입력</Link>
        <Link href="/upload" className="rounded-lg border border-zinc-200 bg-white py-3">엑셀 업로드</Link>
      </nav>
    </main>
  );
}

function Tile({
  href,
  label,
  value,
  unit,
  small,
  tone = "normal",
}: {
  href: string;
  label: string;
  value: string;
  unit?: string;
  small?: boolean;
  tone?: "normal" | "warn";
}) {
  return (
    <Link href={href} className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3 active:bg-zinc-50">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`mt-1 font-bold tabular-nums ${small ? "text-base" : "text-2xl"} ${tone === "warn" ? "text-red-600" : "text-zinc-900"}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span>}
      </span>
    </Link>
  );
}
