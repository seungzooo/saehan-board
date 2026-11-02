"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** 검색창 하나. 입력 후 300ms 지나면 자동 검색, 엔터는 즉시 */
export default function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(value: string) {
    const v = value.trim();
    router.replace(v ? `/stock?q=${encodeURIComponent(v)}` : "/stock");
  }

  useEffect(() => {
    if (q === initialQuery) return;
    timer.current = setTimeout(() => go(q), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        go(q);
      }}
      className="flex gap-2"
    >
      <input
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="품목명 또는 품번"
        autoFocus
        autoComplete="off"
        enterKeyHint="search"
        className="h-12 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-base outline-none focus:border-blue-500"
      />
      <button type="submit" className="h-12 shrink-0 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white">
        검색
      </button>
    </form>
  );
}
