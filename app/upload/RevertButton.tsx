"use client";

import { formatDateTime } from "@/lib/format";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revertStockAction } from "./actions";

/** 최신 재고 배치를 복구해 직전 기준재고로 되돌린다 (배치는 지우지 않고 revertedAt 기록) */
export default function RevertButton({
  batch,
  previous,
}: {
  batch: { id: string; fileName: string; uploadedAt: string };
  previous: { fileName: string; uploadedAt: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function revert() {
    const target = previous ? `${previous.fileName} (${formatDateTime(previous.uploadedAt)})` : "재고 파일 없음 상태";
    if (!window.confirm(`현재 기준 "${batch.fileName}"을(를) 복구하고 ${target}으로 되돌릴까요?\n이 배치 이후 입력한 변동은 그대로 남습니다.`)) return;
    startTransition(async () => {
      const r = await revertStockAction(batch.id);
      if (!r.ok) {
        setMsg(r.message);
        return;
      }
      setMsg(
        r.nowBasis
          ? `복구 완료. 현재 기준: ${r.nowBasis.fileName} (${formatDateTime(r.nowBasis.uploadedAt)})`
          : "복구 완료. 현재 기준 재고 파일이 없습니다.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={revert}
        disabled={pending}
        className="h-10 rounded-md border border-red-300 bg-white px-3 text-sm font-medium text-red-700 disabled:opacity-50"
      >
        {pending ? "복구 중…" : "이전 기준재고로 복구"}
      </button>
      <p className="text-xs text-zinc-500">
        현재 기준: {batch.fileName} · {formatDateTime(batch.uploadedAt)}
        {previous ? ` → 복구 시 ${previous.fileName} (${formatDateTime(previous.uploadedAt)})` : " → 복구 시 재고 파일 없음"}
      </p>
      {msg && <p className="text-xs text-blue-800">{msg}</p>}
    </div>
  );
}
