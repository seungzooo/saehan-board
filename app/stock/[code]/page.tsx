import { ADJUSTMENT_REASONS, REASON_LABEL } from "@/lib/availableStock";
import { formatDateTime } from "@/lib/format";
import { getProductDetail } from "@/lib/stock";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ code }, { q }] = await Promise.all([params, searchParams]);
  const detail = await getProductDetail(decodeURIComponent(code));
  if (!detail) notFound();
  const { product, stock, history } = detail;
  const tone = !stock.hasBaseline ? "text-zinc-400" : stock.available <= 0 ? "text-red-600" : "text-zinc-900";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <Link href={q ? `/stock?q=${encodeURIComponent(q)}` : "/stock"} className="text-sm text-blue-600">
        ← 검색으로
      </Link>

      <header>
        <h1 className="text-xl font-bold">{product.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          <span className="font-mono">{product.code}</span>
          {product.capacity && ` · ${product.capacity}`} · {product.packUnit} {product.unitsPerBox.toLocaleString()}개
          {product.category && ` · ${product.category}`}
        </p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-500">가용재고</p>
        <p className={`text-5xl font-bold tabular-nums ${tone}`}>
          {stock.hasBaseline || stock.available !== 0 ? stock.available.toLocaleString() : "—"}
          <span className="ml-1 text-base font-normal text-zinc-500">박스</span>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">기초재고</dt>
          <dd className="text-right tabular-nums">{stock.hasBaseline ? stock.baseline.toLocaleString() : "업로드 없음"}</dd>
          {ADJUSTMENT_REASONS.map((r) => (
            <Row key={r} label={`${REASON_LABEL[r]} 차감`} value={stock.deductions[r]} />
          ))}
          <dt className="text-zinc-500">오늘 차감</dt>
          <dd className="text-right tabular-nums">{stock.todayDeduction.toLocaleString()}</dd>
          <dt className="text-zinc-500">재고 기준</dt>
          <dd className="text-right">{stock.uploadedAt ? formatDateTime(stock.uploadedAt) : "—"}</dd>
        </dl>
        {!stock.hasBaseline && (
          <p className="mt-3 text-xs text-amber-700">최근 재고 업로드에 이 품목이 없습니다. 기초재고 0으로 계산했습니다.</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">변동 이력</h2>
          <Link
            href={`/adjust?code=${encodeURIComponent(product.code)}`}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white"
          >
            변동 입력
          </Link>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">변동 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {history.map((h) => {
              const cancelled = !!h.cancelledAt;
              const reason = (REASON_LABEL as Record<string, string>)[h.reason] ?? h.reason;
              return (
                <li key={h.id} className={`flex items-center gap-3 px-3 py-2 ${cancelled ? "text-zinc-400 line-through" : ""}`}>
                  <span className="w-10 shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-center text-xs font-medium text-zinc-700">
                    {reason}
                  </span>
                  <span className="w-16 shrink-0 text-right font-semibold tabular-nums">−{h.qtyBox.toLocaleString()}</span>
                  <span className="min-w-0 flex-1 truncate text-zinc-600">{h.memo ?? ""}</span>
                  <span className="shrink-0 text-right text-xs text-zinc-500">
                    {formatDateTime(h.createdAt)}
                    <br />
                    {h.createdBy}
                    {cancelled && " · 취소됨"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-right tabular-nums ${value > 0 ? "text-red-600" : ""}`}>{value > 0 ? `−${value.toLocaleString()}` : "0"}</dd>
    </>
  );
}

