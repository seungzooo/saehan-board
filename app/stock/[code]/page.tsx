import { ADJUSTMENT_REASONS, REASON_LABEL } from "@/lib/availableStock";
import { formatDateTime } from "@/lib/format";
import { getProductDetail, getStockBasis } from "@/lib/stock";
import { availableText, availableTone, BasisLine } from "@/lib/stockDisplay";
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
  const [detail, basis] = await Promise.all([getProductDetail(decodeURIComponent(code)), getStockBasis()]);
  if (!detail) notFound();
  const { product, stock, history } = detail;
  const needsCheck = stock.available === null;
  // 품목이 파일에 없어도(확인 필요) 최근 재고 파일의 집계·반영 시각은 보여준다
  const asOf = stock.stockAsOf ?? basis?.stockAsOf ?? null;
  const uploadedAt = stock.uploadedAt ?? basis?.uploadedAt ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <Link href={q ? `/stock?q=${encodeURIComponent(q)}` : "/stock"} className="text-sm text-blue-600">
        ← 검색으로
      </Link>

      <header className="min-w-0">
        <h1 className="break-words text-xl font-bold">{product.name}</h1>
        <p className="mt-1 break-words text-sm text-zinc-500">
          <span className="font-mono">{product.code}</span>
          {product.capacity && ` · ${product.capacity}`} · {product.packUnit} {product.unitsPerBox.toLocaleString()}개
          {product.category && ` · ${product.category}`}
        </p>
      </header>

      <section data-testid="stock-summary" className="rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-500">가용재고</p>
        <p data-testid="available" className={`font-bold tabular-nums ${needsCheck ? "text-3xl" : "text-5xl"} ${availableTone(stock)}`}>
          {availableText(stock)}
          {!needsCheck && <span className="ml-1 text-base font-normal text-zinc-500">박스</span>}
        </p>
        <BasisLine basis={basis} className="mt-1" />
        {needsCheck && (
          <p className="mt-2 text-sm text-amber-700">
            최근 재고 파일에 이 품목이 없습니다. 재고 담당자가 다음 파일에 포함시키면 수량이 표시됩니다.
          </p>
        )}
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-zinc-500">기초재고</dt>
          <dd className="text-right tabular-nums">{needsCheck ? "—" : stock.baseline!.toLocaleString()}</dd>
          {ADJUSTMENT_REASONS.map((r) => (
            <Row key={r} label={`${REASON_LABEL[r]} 차감`} value={stock.deductions[r]} />
          ))}
          <dt className="text-zinc-500">오늘 차감</dt>
          <dd className="text-right tabular-nums">{stock.todayDeduction.toLocaleString()}</dd>
          <dt className="text-zinc-500">집계 기준</dt>
          <dd className="text-right">{asOf ? formatDateTime(asOf) : "미확인"}</dd>
          <dt className="text-zinc-500">반영 시각</dt>
          <dd className="text-right">{uploadedAt ? formatDateTime(uploadedAt) : "—"}</dd>
        </dl>
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
