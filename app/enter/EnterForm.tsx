"use client";

import { useState, useTransition } from "react";
import { enterAction } from "./actions";

export default function EnterForm({ next }: { next: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      data-testid="enter-form"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(async () => {
          const r = await enterAction(fd);
          if (r.ok) window.location.assign(r.next); // 쿠키를 받은 뒤 전체 새로고침으로 이동
          else setMsg(r.message);
        });
      }}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4"
    >
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-700">열람 코드</span>
        <input
          name="code"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          required
          aria-label="열람 코드"
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
      <p className="text-xs text-zinc-500">한 번 입력하면 이 기기에서 30일 유지됩니다.</p>
    </form>
  );
}
