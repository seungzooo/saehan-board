import AdjustmentTable, { ReasonBadge } from "@/components/AdjustmentTable";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

/** 변동 상세: 원기록·정정·연결 수주/출고를 한 화면에. 품목·변동 입력으로 이어진다 */
export default async function AdjustmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n)) notFound();
  const a = await prisma.stockAdjustment.findUnique({
    where: { id: n },
    include: {
      product: { select: { code: true, name: true } },
      order: { select: { id: true, qtyBox: true, createdAt: true, cancelledAt: true } },
      shipments: { select: { id: true, qtyBox: true, createdAt: true, cancelledAt: true, createdBy: true, memo: true, reason: true, correctsId: true } },
      corrects: { select: { id: true, qtyBox: true, createdAt: true } },
      corrections: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!a) notFound();
  const effective = a.correctsId ? null : a.qtyBox + a.corrections.filter((c) => !c.cancelledAt).reduce((s, c) => s + c.qtyBox, 0);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
      <Link href="/adjust" className="text-sm text-blue-600">
        ← 변동 입력
      </Link>
      <header>
        <p className="text-xs text-zinc-500">변동 #{a.id}</p>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
          <ReasonBadge reason={a.reason} isCorrection={a.correctsId != null} />
          <span className={`num ${a.cancelledAt ? "text-zinc-400 line-through" : ""}`}>
            {a.qtyBox > 0 ? "−" : "+"}
            {Math.abs(a.qtyBox).toLocaleString()}박스
          </span>
          {a.cancelledAt && <span className="text-sm font-normal text-zinc-500">취소됨</span>}
        </h1>
        <Link href={`/stock/${encodeURIComponent(a.product.code)}`} className="mt-1 inline-block text-base text-blue-600">
          {a.product.name} ({a.product.code}) 재고 보기 →
        </Link>
      </header>

      <dl className="num grid grid-cols-[6rem_1fr] gap-y-2 rounded-lg border border-zinc-200 p-4 text-sm">
        <dt className="text-zinc-500">입력 시각</dt>
        <dd>{formatDateTime(a.createdAt)}</dd>
        <dt className="text-zinc-500">입력자</dt>
        <dd>{a.createdBy}</dd>
        <dt className="text-zinc-500">메모</dt>
        <dd>{a.memo ?? "—"}</dd>
        {a.cancelledAt && (
          <>
            <dt className="text-zinc-500">취소 시각</dt>
            <dd>{formatDateTime(a.cancelledAt)}</dd>
          </>
        )}
        {a.correctionReason && (
          <>
            <dt className="text-zinc-500">정정 사유</dt>
            <dd>{a.correctionReason}</dd>
          </>
        )}
        {effective !== null && a.corrections.length > 0 && (
          <>
            <dt className="text-zinc-500">정정 반영 수량</dt>
            <dd className="font-semibold">{effective.toLocaleString()}박스</dd>
          </>
        )}
        {a.corrects && (
          <>
            <dt className="text-zinc-500">원기록</dt>
            <dd>
              <Link href={`/adjust/${a.corrects.id}`} className="text-blue-600">
                #{a.corrects.id} · {a.corrects.qtyBox.toLocaleString()}박스 · {formatDateTime(a.corrects.createdAt)} →
              </Link>
            </dd>
          </>
        )}
        {a.order && (
          <>
            <dt className="text-zinc-500">이행한 수주</dt>
            <dd>
              <Link href={`/adjust/${a.order.id}`} className="text-blue-600">
                수주 #{a.order.id} · {a.order.qtyBox.toLocaleString()}박스 · {formatDateTime(a.order.createdAt)} →
              </Link>
              <span className="block text-xs text-zinc-500">이 출고로 해당 수주 차감은 해제되었습니다.</span>
            </dd>
          </>
        )}
      </dl>

      {a.reason === "ORDER" && (
        <section>
          <h2 className="mb-2 text-base font-semibold">이 수주를 이행한 출고</h2>
          <AdjustmentTable
            rows={a.shipments.map((s) => ({
              id: s.id,
              createdAt: s.createdAt,
              reason: s.reason,
              qtyBox: s.qtyBox,
              createdBy: s.createdBy,
              memo: s.memo,
              cancelled: !!s.cancelledAt,
              isCorrection: s.correctsId != null,
            }))}
          />
        </section>
      )}

      {a.corrections.length > 0 && (
        <section>
          <h2 className="mb-2 text-base font-semibold">정정 기록</h2>
          <AdjustmentTable
            rows={a.corrections.map((c) => ({
              id: c.id,
              createdAt: c.createdAt,
              reason: c.reason,
              qtyBox: c.qtyBox,
              createdBy: c.createdBy,
              memo: c.correctionReason ?? c.memo,
              cancelled: !!c.cancelledAt,
              isCorrection: true,
            }))}
          />
        </section>
      )}

      <Link
        href={`/adjust?code=${encodeURIComponent(a.product.code)}`}
        className="flex h-12 items-center justify-center rounded-lg bg-blue-600 text-base font-semibold text-white"
      >
        이 품목 변동 입력·정정·취소
      </Link>
    </main>
  );
}
