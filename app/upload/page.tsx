import PinGate from "@/components/PinGate";
import type { UploadKind } from "@/config/excel-mapping";
import { cachedCompletionInfo } from "@/lib/analytics/cached";
import { prisma } from "@/lib/db";
import { UPLOAD_KIND_LABEL } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import { getStockBasis } from "@/lib/stock";
import { BasisLine } from "@/lib/stockDisplay";
import Link from "next/link";
import RecentUploads from "./RecentUploads";
import RevertButton from "./RevertButton";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

async function UploadPageInner({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const initialKind = (Object.keys(UPLOAD_KIND_LABEL).includes(kind ?? "") ? kind : "STOCK") as UploadKind;

  const [batches, basis, stockBatches, completion] = await Promise.all([
    prisma.uploadBatch.findMany({ orderBy: { uploadedAt: "desc" }, take: 30 }),
    getStockBasis(),
    prisma.uploadBatch.findMany({ where: { kind: "STOCK", revertedAt: null }, orderBy: { uploadedAt: "desc" }, take: 2 }),
    cachedCompletionInfo(),
  ]);
  const latestStock = stockBatches[0] ?? null;
  const previousStock = stockBatches[1] ?? null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">엑셀 업로드</h1>
        <p className="mt-1 text-sm text-zinc-700">매일 아침 ERP 재고 엑셀을 올리면 영업팀이 최신 수량을 봅니다.</p>
        <BasisLine basis={basis} long className="mt-1 text-sm" />
        <div className="num mt-2 flex flex-col gap-0.5 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600" data-testid="upload-completion">
          {(["sales", "production"] as const).map((k) => {
            const c = completion[k];
            return (
              <p key={k}>
                {k === "sales" ? "출고실적" : "생산실적"} 집계 완료 월 <b className="text-zinc-800">{c?.completeThrough ?? "없음"}</b>
                {c && (
                  <>
                    {" "}
                    —{" "}
                    <Link href={`/upload/${c.id}`} className="text-blue-600 underline">
                      {c.fileName}
                    </Link>
                    에서 정함 (상세에서 수정)
                  </>
                )}
              </p>
            );
          })}
        </div>
      </header>

      <UploadForm initialKind={initialKind} />

      {latestStock && (
        <RevertButton
          batch={{ id: latestStock.id, fileName: latestStock.fileName, uploadedAt: latestStock.uploadedAt.toISOString() }}
          previous={previousStock ? { fileName: previousStock.fileName, uploadedAt: previousStock.uploadedAt.toISOString() } : null}
        />
      )}

      <RecentUploads
        items={batches.map((b) => ({
          id: b.id,
          kindKey: b.kind,
          reverted: !!b.revertedAt,
          kind: UPLOAD_KIND_LABEL[b.kind as UploadKind] ?? b.kind,
          fileName: b.fileName,
          rowCount: b.rowCount,
          uploadedAt: formatDateTime(b.uploadedAt),
          uploadedBy: b.uploadedBy,
        }))}
      />
    </main>
  );
}

/** PIN 보호: UPLOAD_PIN 세션이 있어야 열린다 (없으면 PIN 입력 / 미설정 안내) */
export default async function UploadPage(props: Parameters<typeof UploadPageInner>[0]) {
  return (
    <PinGate title="엑셀 업로드">
      <UploadPageInner {...props} />
    </PinGate>
  );
}
