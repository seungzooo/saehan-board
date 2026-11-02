import type { UploadKind } from "@/config/excel-mapping";
import { canUpload, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UPLOAD_KIND_LABEL } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import { redirect } from "next/navigation";
import RecentUploads from "./RecentUploads";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await getCurrentUser();
  if (!canUpload(user)) redirect("/stock");
  const { kind } = await searchParams;
  const initialKind = (Object.keys(UPLOAD_KIND_LABEL).includes(kind ?? "") ? kind : "STOCK") as UploadKind;

  const [batches, latestStock] = await Promise.all([
    prisma.uploadBatch.findMany({ orderBy: { uploadedAt: "desc" }, take: 30 }),
    prisma.uploadBatch.findFirst({ where: { kind: "STOCK" }, orderBy: { uploadedAt: "desc" } }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">엑셀 업로드</h1>
        <p className="mt-1 text-sm text-zinc-700">매일 아침 ERP 재고 엑셀을 올리면 영업팀이 최신 수량을 봅니다.</p>
        <p className="mt-1 text-sm text-zinc-600">
          재고 기준 시점:{" "}
          {latestStock ? (
            <span className="font-medium text-zinc-900">{formatDateTime(latestStock.uploadedAt)}</span>
          ) : (
            <span className="text-red-600">아직 재고 업로드 없음</span>
          )}
        </p>
      </header>

      <UploadForm initialKind={initialKind} />

      <RecentUploads
        items={batches.map((b) => ({
          id: b.id,
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
