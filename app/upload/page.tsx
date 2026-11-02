import type { UploadKind } from "@/config/excel-mapping";
import { canUpload, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UPLOAD_KIND_LABEL } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import { redirect } from "next/navigation";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await getCurrentUser();
  if (!canUpload(user)) redirect("/stock");
  const { kind } = await searchParams;
  const initialKind = (Object.keys(UPLOAD_KIND_LABEL).includes(kind ?? "") ? kind : "STOCK") as UploadKind;

  const [batches, latestStock] = await Promise.all([
    prisma.uploadBatch.findMany({ orderBy: { uploadedAt: "desc" }, take: 20 }),
    prisma.uploadBatch.findFirst({ where: { kind: "STOCK" }, orderBy: { uploadedAt: "desc" } }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
      <header>
        <h1 className="text-xl font-bold">엑셀 업로드</h1>
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

      <section>
        <h2 className="mb-2 text-base font-semibold">최근 업로드</h2>
        {batches.length === 0 ? (
          <p className="text-sm text-zinc-500">업로드 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-20 shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-center text-xs font-medium">
                  {UPLOAD_KIND_LABEL[b.kind as UploadKind] ?? b.kind}
                </span>
                <span className="min-w-0 flex-1 truncate">{b.fileName}</span>
                <span className="shrink-0 text-zinc-500">{b.rowCount.toLocaleString()}행</span>
                <span className="shrink-0 text-zinc-500">{formatDateTime(b.uploadedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
