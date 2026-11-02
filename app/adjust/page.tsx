import { listRecentAdjustments } from "@/lib/adjust";
import { canAdjust, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import AdjustForm from "./AdjustForm";

export const dynamic = "force-dynamic";

export default async function AdjustPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const user = await getCurrentUser();
  if (!canAdjust(user)) redirect("/stock");
  const { code } = await searchParams;

  const [preselected, recent] = await Promise.all([
    code
      ? prisma.product.findUnique({
          where: { code },
          select: { code: true, name: true, capacity: true, packUnit: true, unitsPerBox: true },
        })
      : Promise.resolve(null),
    listRecentAdjustments(50),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-xl font-bold">변동 입력</h1>
      <AdjustForm preselected={preselected} initialRecent={recent} />
    </main>
  );
}
