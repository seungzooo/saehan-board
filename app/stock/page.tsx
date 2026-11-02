import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

// F3 자리. 지금은 기준 시점과 품목 수만 보여준다.
export default async function StockPage() {
  const [latest, products] = await Promise.all([
    prisma.uploadBatch.findFirst({ where: { kind: "STOCK" }, orderBy: { uploadedAt: "desc" } }),
    prisma.product.count({ where: { isActive: true } }),
  ]);
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">가용재고 조회</h1>
      <p className="text-sm text-zinc-600">
        재고 기준: {latest ? formatDateTime(latest.uploadedAt) : "업로드 없음"} · 품목 {products.toLocaleString()}개
      </p>
      <p className="text-sm text-zinc-500">F3 검색 화면은 다음 단계에서 구현합니다.</p>
    </main>
  );
}
