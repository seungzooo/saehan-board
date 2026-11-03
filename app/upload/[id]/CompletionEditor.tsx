"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCompletionAction } from "../actions";

/** 업로드 상세: 집계 완료 월 수정 (화면·액션 모두 PIN 보호) */
export default function CompletionEditor({ batchId, initial, lastDataYm }: { batchId: string; initial: string | null; lastDataYm: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      data-testid="completion-editor"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await updateCompletionAction(batchId, value);
          setMsg(r.ok ? { ok: true, text: `집계 완료 월을 ${r.value}로 저장했습니다. 분석 화면에 바로 반영됩니다.` } : { ok: false, text: r.message });
          if (r.ok) router.refresh();
        });
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">집계 완료 월 수정</span>
        <input
          type="month"
          value={value}
          max={lastDataYm ?? undefined}
          onChange={(e) => setValue(e.target.value)}
          className="num h-11 rounded-md border border-zinc-300 px-3 text-base"
          aria-label="집계 완료 월"
        />
      </label>
      <button
        type="submit"
        disabled={pending || !value || value === initial}
        className="h-11 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:bg-zinc-300"
      >
        {pending ? "저장 중…" : "저장"}
      </button>
      {msg && <p className={`w-full text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </form>
  );
}
