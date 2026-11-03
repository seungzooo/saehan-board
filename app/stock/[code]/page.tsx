import AdjustmentTable from "@/components/AdjustmentTable";
import CalcBar from "@/components/CalcBar";
import { ChartHead, Sparkline } from "@/components/charts";
import { getProductActivity } from "@/lib/activity";
import { getDailyShipments, getProductDetail } from "@/lib/stock";
import { availableText, BasisLine, daysText, productInfoText, StatusBadge, stockStatus } from "@/lib/stockDisplay";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** 품목 상세: 품명 → 현재 재고(큰 숫자) → 집계·반영 시각 → 계산 근거 → 출고 추이 → 변동 이력 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ code }, { q }] = await Promise.all([params, searchParams]);
  const productCode = decodeURIComponent(code);
  const [detail, daily, act] = await Promise.all([getProductDetail(productCode), getDailyShipments(productCode), getProductActivity(productCode)]);
  if (!detail) notFound();
  const { product, stock, days, history } = detail;
  const needsCheck = stock.available === null;
  const st = stockStatus(stock, days);
  // 최신 파일에 없는 품목에는 파일 시각을 보여주지 않는다 — "확인 필요"만
  const basis = !needsCheck && stock.uploadedAt ? { uploadedAt: stock.uploadedAt, stockAsOf: stock.stockAsOf, batchId: "" } : null;
  const shippedTotal = daily.days.reduce((s, d) => s + d.qtyBox, 0);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
      <Link href={q ? `/?q=${encodeURIComponent(q)}` : "/"} className="text-sm text-blue-600">
        ← 재고 검색
      </Link>

      {/* 품명 */}
      <header className="min-w-0">
        <h1 className="break-words text-xl font-bold">{product.name}</h1>
        <p className="mt-0.5 break-words text-sm text-zinc-500">{productInfoText(product)}</p>
        <p data-testid="managed-status" className="num mt-1 text-xs text-zinc-600">
          {act.managed ? (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-700">관리 대상</span>
          ) : (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-semibold text-zinc-600">휴면</span>
          )}
          <span className="ml-1">
            최근 정상·내수 출고 {act.lastShipDate ?? "없음"}
            {act.basis && ` · 기준 ${act.basis.fromYm}~${act.basis.basisYm}`}
          </span>
        </p>
      </header>

      {/* 현재 재고 */}
      <section data-testid="stock-summary" className={`rounded-lg border p-4 ${st.cardClass}`}>
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">현재 재고</p>
          <StatusBadge status={st} />
        </div>
        <p data-testid="available" className={`num font-bold leading-tight ${needsCheck ? "text-4xl" : "text-6xl"} ${st.numClass}`}>
          {availableText(stock)}
          {!needsCheck && <span className="ml-1 text-xl font-normal text-zinc-500">박스</span>}
        </p>
        <p data-testid="allocation-note" className="mt-1 text-xs text-zinc-500">
          다른 거래처 배정분 반영 여부는 생산지원팀 확인
        </p>
        {needsCheck ? (
          <p className="mt-1 text-sm text-zinc-600">최근 재고 파일에 이 품목이 없습니다. 재고 담당자가 다음 파일에 포함시키면 수량이 표시됩니다.</p>
        ) : (
          <>
            <BasisLine basis={basis} long className="mt-1" />
            <p className="num mt-1 text-sm text-zinc-600">
              예상 소진 <b className={st.key === "LOW" ? "text-orange-700" : ""}>{daysText(days)}</b>
              {days.avgPerDay !== null && days.avgPerDay > 0 && (
                <span className="text-zinc-500"> · 최근 30일 일평균 {Number(days.avgPerDay.toFixed(1)).toLocaleString()}박스</span>
              )}
            </p>
          </>
        )}
      </section>

      {/* 계산 근거 */}
      <section>
        <h2 className="mb-2 text-base font-semibold">계산 근거</h2>
        <CalcBar stock={stock} />
      </section>

      {/* 최근 30일 일별 출고 */}
      <section>
        <ChartHead title="최근 30일 일별 출고" unit="박스" basis={daily.basisTo ? `출고실적 ${daily.basisTo}까지` : null} />
        {daily.days.length === 0 || shippedTotal === 0 ? (
          <p className="text-sm text-zinc-500">최근 30일 출고 실적이 없습니다 — 소진일수 산정 불가.</p>
        ) : (
          <>
            <Sparkline data={daily.days} />
            <p className="num text-xs text-zinc-500">
              30일 합계 {Math.round(shippedTotal).toLocaleString()}박스 · 출고한 날 {daily.days.filter((d) => d.qtyBox > 0).length}일
            </p>
          </>
        )}
        <Link href={`/analytics?code=${encodeURIComponent(product.code)}`} className="mt-1 inline-block text-sm text-blue-600">
          생산·출고 추이와 계절 패턴 보기 →
        </Link>
      </section>

      {/* 변동 이력 */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">변동 이력</h2>
          <Link
            href={`/adjust?code=${encodeURIComponent(product.code)}`}
            className="flex h-10 items-center rounded-md bg-blue-600 px-3 text-sm font-semibold text-white"
          >
            변동 입력
          </Link>
        </div>
        <AdjustmentTable
          rows={history.map((h) => ({
            id: h.id,
            createdAt: h.createdAt,
            reason: h.reason,
            qtyBox: h.qtyBox,
            createdBy: h.createdBy,
            memo: h.memo,
            cancelled: !!h.cancelledAt,
            isCorrection: h.correctsId != null,
          }))}
        />
      </section>
    </main>
  );
}
