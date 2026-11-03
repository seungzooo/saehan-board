"use client";

import { pinLoginAction } from "@/app/pin-actions";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function PinForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      data-testid="pin-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await pinLoginAction(fd);
          if (r.ok) router.refresh();
          else setMsg(r.message);
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">재고 담당자 공용 PIN</span>
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          required
          aria-label="PIN"
          className="num h-14 rounded-lg border border-zinc-300 px-4 text-2xl tracking-widest outline-none focus:border-blue-600"
        />
      </label>
      {msg && (
        <p role="alert" className="text-sm text-red-700">
          {msg}
        </p>
      )}
      <button type="submit" disabled={pending} className="h-12 rounded-lg bg-blue-600 text-base font-semibold text-white disabled:bg-zinc-300">
        {pending ? "확인 중…" : "확인"}
      </button>
      <p className="text-xs text-zinc-500">한 번 입력하면 이 기기에서 12시간 유지됩니다.</p>
    </form>
  );
}
