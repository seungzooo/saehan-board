import PinGate from "@/components/PinGate";
import { listOpenOrders, listRecentAdjustments } from "@/lib/adjust";
import { prisma } from "@/lib/db";
import { computeForProducts } from "@/lib/stock";
import { stockLabels } from "./actions";
import AdjustForm from "./AdjustForm";

export const dynamic = "force-dynamic";

async function AdjustPageInner({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;

  const [preselected, recent, openOrders, stocks] = await Promise.all([
    code
      ? prisma.product.findUnique({
          where: { code },
          select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true, category: true },
        })
      : Promise.resolve(null),
    listRecentAdjustments(50),
    code ? listOpenOrders(code) : Promise.resolve([]),
    code ? computeForProducts([code]) : Promise.resolve(new Map()),
  ]);
  const initialStock = code ? (stocks.get(code) ?? null) : null;
  const initialLabels = await stockLabels(recent.map((r) => r.productCode));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">변동 입력</h1>
      <AdjustForm preselected={preselected} initialStock={initialStock} initialOpenOrders={openOrders} initialRecent={recent} initialLabels={initialLabels} />
    </main>
  );
}

/** PIN 보호: UPLOAD_PIN 세션이 있어야 열린다 (없으면 PIN 입력 / 미설정 안내) */
export default async function AdjustPage(props: Parameters<typeof AdjustPageInner>[0]) {
  return (
    <PinGate title="변동 입력">
      <AdjustPageInner {...props} />
    </PinGate>
  );
}
