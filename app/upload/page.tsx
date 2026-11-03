import { STALE_AFTER_HOURS } from "@/config/stock";
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

      <details data-testid="ops-guide" className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-700">
        <summary className="cursor-pointer font-semibold">운영 안내 — 재고 파일 올리기</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          <li>
            <b>누가·언제:</b> 생산지원팀 재고 담당자가 매일 오전(업무 시작 후 10시까지 권장) ERP에서 재고 엑셀을 내려받아 올립니다. 시각·담당은 회사 확정 전
            운영 가정입니다.
          </li>
          <li>
            <b>입력:</b> &ldquo;집계 기준 시각&rdquo;에 ERP에서 재고를 조회한 시각을 넣고, 사후 불량이 파일에 반영됐는지 고릅니다(둘 다 필수). 미리보기에 직전 기준
            이후 입력된 불량이 보이면 그 근거로 답하세요.
          </li>
          <li>
            <b>올리지 않으면:</b> 품목의 집계 기준 시각에서 {STALE_AFTER_HOURS}시간(<code>config/stock.ts STALE_AFTER_HOURS</code>)이 지나면 영업 화면에 &ldquo;오늘 자료
            미반영&rdquo;이 표시됩니다. 마지막 확인 수량과 시각은 보이지만 요청 수량 판정(충족·부족)은 보류됩니다. 그 사이 앱에 입력한 불량·출고는 계속 차감됩니다.
          </li>
          <li>
            <b>잘못 올렸을 때:</b> 아래 &ldquo;이전 기준재고로 복구&rdquo;를 누르면 직전 파일이 다시 기준이 됩니다(업로드 상세에서도 가능). 현재 기준보다 이전 집계
            시각의 파일은 앱이 받지 않습니다. 같은 파일·같은 설정은 다시 저장되지 않습니다.
          </li>
        </ul>
      </details>

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
