import { listOpenOrders, listRecentAdjustments } from "@/lib/adjust";
import { prisma } from "@/lib/db";
import AdjustForm from "./AdjustForm";

export const dynamic = "force-dynamic";

export default async function AdjustPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;

  const [preselected, recent, openOrders] = await Promise.all([
    code
      ? prisma.product.findUnique({
          where: { code },
          select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
        })
      : Promise.resolve(null),
    listRecentAdjustments(50),
    code ? listOpenOrders(code) : Promise.resolve([]),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">변동 입력</h1>
      <AdjustForm preselected={preselected} initialOpenOrders={openOrders} initialRecent={recent} />
    </main>
  );
}
