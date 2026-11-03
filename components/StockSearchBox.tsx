"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * 재고 검색창 — 상단 고정, 높이 56px, 자동 포커스. 입력 후 300ms 자동 검색, 엔터는 즉시.
 * "휴면 품목 포함" 토글: 기본은 관리 대상만 검색.
 */
export default function StockSearchBox({
  initialQuery,
  includeDormant = false,
  basePath = "/",
}: {
  initialQuery: string;
  includeDormant?: boolean;
  basePath?: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(value: string, dormant = includeDormant) {
    const v = value.trim();
    const p = new URLSearchParams();
    if (v) p.set("q", v);
    if (dormant) p.set("dormant", "1");
    const s = p.toString();
    router.replace(s ? `${basePath}?${s}` : basePath);
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
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        go(q);
      }}
      className="sticky top-12 z-10 -mx-4 border-b border-zinc-200 bg-white px-4 py-2"
    >
      <div className="flex gap-2">
        <input
          type="search"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="품목명 또는 품번 (예: 2L, 식용유)"
          aria-label="품목 검색"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          className="h-14 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-4 text-lg outline-none focus:border-blue-600"
        />
        <button type="submit" className="h-14 shrink-0 rounded-lg bg-blue-600 px-5 text-base font-semibold text-white">
          검색
        </button>
      </div>
      <label className="mt-1 inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-zinc-600">
        <input
          type="checkbox"
          checked={includeDormant}
          onChange={(e) => go(q, e.target.checked)}
          className="h-4 w-4 accent-blue-600"
          data-testid="dormant-toggle"
        />
        휴면 품목 포함
      </label>
    </form>
  );
}
