import PinGate from "@/components/PinGate";
import type { UploadKind } from "@/config/excel-mapping";
import { getBatchDetail, UPLOAD_KIND_LABEL } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import { basisText, SampleBadge } from "@/lib/stockDisplay";
import Link from "next/link";
import { notFound } from "next/navigation";
import CancelBatchButton from "./CancelBatchButton";
import CompletionEditor from "./CompletionEditor";

export const dynamic = "force-dynamic";

/** 업로드 상세: 재고면 품목별 이전 → 새 수량, 건수, "이 업로드 취소", "재고 보기" */
async function UploadDetailPageInner({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const [{ id }, { page: pageRaw }] = await Promise.all([params, searchParams]);
  const d = await getBatchDetail(id);
  if (!d) notFound();
  const b = d.batch;
  const PAGE = 100;
  const page = Math.max(1, Number(pageRaw) || 1);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4">
      <Link href="/upload" className="text-sm text-blue-600">
        ← 업로드
      </Link>
      <header>
        <p className="text-xs text-zinc-500">{UPLOAD_KIND_LABEL[b.kind as UploadKind] ?? b.kind} 업로드</p>
        <h1 className="break-all text-lg font-bold">
          {b.fileName}
          <SampleBadge fileName={b.fileName} />
          {b.revertedAt && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-semibold text-zinc-600">취소됨</span>}
        </h1>
        <p className="num text-sm text-zinc-600">
          파일 반영 {formatDateTime(b.uploadedAt)} · {b.uploadedBy} · 파일 {b.rowCount.toLocaleString()}행
          {b.revertedAt && ` · 취소 ${formatDateTime(b.revertedAt)}`}
        </p>
        {d.kind === "STOCK" && (
          <p className="text-sm text-zinc-600">
            {basisText({ uploadedAt: b.uploadedAt, stockAsOf: b.stockAsOf }, true)} · {b.mode === "MERGE" ? "있는 품목만 갱신" : "전체 교체"} · 사후 불량{" "}
            {b.defectApplied ? "반영됨(이전 불량 리셋)" : "미반영"}
          </p>
        )}
      </header>

      {d.kind === "STOCK" && (
        <>
          <div className="num grid grid-cols-5 gap-2 text-center text-sm">
            {(
              [
                ["신규", d.counts.added],
                ["변경", d.counts.changed],
                ["동일", d.counts.same],
                ["누락", d.counts.missing],
                ["건너뜀", d.counts.skipped],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="rounded-lg border border-zinc-200 p-2">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="text-xl font-bold">{n.toLocaleString()}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            비교 대상: {d.previous ? `${d.previous.fileName} (${formatDateTime(d.previous.uploadedAt)})` : "직전 기준재고 없음 — 첫 업로드"} · 건너뜀 = 파일 행 중
            오류·같은 품번 합산으로 저장되지 않은 행
          </p>

          <div className="flex flex-wrap gap-2">
            <Link href="/" className="flex h-12 items-center rounded-lg bg-blue-600 px-4 text-base font-semibold text-white">
              재고 보기 →
            </Link>
          </div>

          <section>
            <h2 className="mb-2 text-base font-semibold">품목별 이전 → 새 수량</h2>
            <div className="overflow-hidden rounded-lg border border-zinc-200">
              <table className="num w-full table-fixed text-sm">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">품목</th>
                    <th className="w-16 px-2 py-2 text-right font-medium">이전</th>
                    <th className="w-16 px-2 py-2 text-right font-medium">새</th>
                    <th className="w-16 px-2 py-2 text-right font-medium">차이</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {d.rows.slice((page - 1) * PAGE, page * PAGE).map((r) => {
                    const diff = r.before !== null && r.after !== null ? r.after - r.before : null;
                    return (
                      <tr key={r.code} className="hover:bg-blue-50">
                        <td className="truncate px-2 py-0">
                          <Link href={`/stock/${encodeURIComponent(r.code)}`} className="block py-3">
                            {r.name}
                            <span className="ml-1 text-xs text-zinc-500">{r.code}</span>
                          </Link>
                        </td>
                        <td className="px-2 py-3 text-right">{r.before === null ? <span className="text-xs text-blue-700">신규</span> : r.before.toLocaleString()}</td>
                        <td className="px-2 py-3 text-right font-semibold">{r.after === null ? <span className="text-xs text-zinc-500">누락</span> : r.after.toLocaleString()}</td>
                        <td className={`px-2 py-3 text-right ${diff === null ? "" : diff < 0 ? "text-red-700" : diff > 0 ? "text-blue-700" : "text-zinc-400"}`}>
                          {diff === null ? "—" : diff === 0 ? "0" : `${diff > 0 ? "+" : ""}${diff.toLocaleString()}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {d.rows.length > PAGE && (
              <nav className="num mt-2 flex justify-between text-sm">
                {page > 1 ? <Link href={`/upload/${b.id}?page=${page - 1}`} className="text-blue-600">← 이전 {PAGE}</Link> : <span />}
                <span className="text-zinc-500">
                  {page} / {Math.ceil(d.rows.length / PAGE)}
                </span>
                {page * PAGE < d.rows.length ? <Link href={`/upload/${b.id}?page=${page + 1}`} className="text-blue-600">다음 {PAGE} →</Link> : <span />}
              </nav>
            )}
          </section>
        </>
      )}

      {(d.kind === "SALES" || d.kind === "PRODUCTION") && (
        <>
          <div className="num grid grid-cols-2 gap-2 text-center text-sm">
            <div className="rounded-lg border border-zinc-200 p-3">
              <p className="text-xs text-zinc-500">이 업로드로 추가된 행</p>
              <p className="text-2xl font-bold">{d.inserted.toLocaleString()}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3">
              <p className="text-xs text-zinc-500">건너뜀 (이미 있던 행·오류·합계행)</p>
              <p className="text-2xl font-bold">{d.skipped.toLocaleString()}</p>
            </div>
          </div>
          {d.period && (
            <p className="num text-sm text-zinc-600">
              기간 {d.period.from} ~ {d.period.to}
            </p>
          )}
          <section className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3" data-testid="completion-section">
            <p className="num text-sm">
              집계 완료 월 <b data-testid="batch-complete-through">{b.completeThrough ?? "없음"}</b>
              {b.completeThroughSetAt && <span className="text-xs text-zinc-500"> · {formatDateTime(b.completeThroughSetAt)} 정함</span>}
            </p>
            <p className="text-xs text-zinc-600">
              {d.isEffectiveCompletion
                ? "지금 분석 화면이 이 값을 씁니다 (가장 최근 업로드)."
                : d.effectiveCompletion
                  ? `지금 분석 화면은 더 최근 업로드 "${d.effectiveCompletion.fileName}"의 ${d.effectiveCompletion.completeThrough}를 씁니다.`
                  : "집계 완료 월이 정해진 업로드가 없습니다."}{" "}
              이 달 이후는 분석 비교에서 &ldquo;집계 중&rdquo;으로 빠집니다. 자료 마지막 달 {d.lastDataYm ?? "—"}보다 늦게 정할 수 없습니다.
            </p>
            {!b.revertedAt && <CompletionEditor batchId={b.id} initial={b.completeThrough} lastDataYm={d.lastDataYm} />}
          </section>
          <Link href="/analytics" className="flex h-12 w-fit items-center rounded-lg bg-blue-600 px-4 text-base font-semibold text-white">
            추이 보기 →
          </Link>
        </>
      )}

      <section className="border-t border-zinc-200 pt-4">
        {d.canCancel ? (
          <CancelBatchButton
            batchId={b.id}
            label={d.kind === "STOCK" ? "이 업로드 취소 (이전 기준재고로 복원)" : "이 업로드 취소 (추가된 행 삭제)"}
            confirmText={
              d.kind === "STOCK"
                ? `"${b.fileName}" 업로드를 취소하고 직전 기준재고로 되돌릴까요? 이후 입력한 변동은 그대로 남습니다.`
                : `"${b.fileName}"으로 추가된 실적 행을 지우고 월별 집계를 다시 계산할까요?`
            }
          />
        ) : (
          <p className="text-sm text-zinc-500">{d.cancelBlockedReason}</p>
        )}
      </section>
    </main>
  );
}

/** PIN 보호: UPLOAD_PIN 세션이 있어야 열린다 (없으면 PIN 입력 / 미설정 안내) */
export default async function UploadDetailPage(props: Parameters<typeof UploadDetailPageInner>[0]) {
  return (
    <PinGate title="업로드 상세">
      <UploadDetailPageInner {...props} />
    </PinGate>
  );
}
