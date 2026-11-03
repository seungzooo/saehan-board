"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelBatchAction } from "../actions";

export default function CancelBatchButton({ batchId, label, confirmText }: { batchId: string; label: string; confirmText: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(confirmText)) return;
          startTransition(async () => {
            const r = await cancelBatchAction(batchId);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          });
        }}
        className="h-12 rounded-lg border border-red-300 bg-white px-4 text-base font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "취소 중…" : label}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
