"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * 목록 안 검색 + "휴면 품목 포함" 토글. 바꾸면 page를 지워 1페이지로 돌아간다.
 * 다른 쿼리(view 등)는 유지한다.
 */
export default function ListControls({
  initialQuery,
  includeDormant,
  showToggle = true,
  placeholder = "목록에서 품명·품번 찾기",
  queryParam = "q",
}: {
  initialQuery: string;
  includeDormant: boolean;
  showToggle?: boolean;
  placeholder?: string;
  queryParam?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(next: { q?: string; dormant?: boolean }) {
    const p = new URLSearchParams(sp.toString());
    p.delete("page");
    const nq = (next.q ?? q).trim();
    if (nq) p.set(queryParam, nq);
    else p.delete(queryParam);
    const nd = next.dormant ?? includeDormant;
    if (nd) p.set("dormant", "1");
    else p.delete("dormant");
    const s = p.toString();
    router.replace(s ? `${path}?${s}` : path);
  }

  useEffect(() => {
    if (q === initialQuery) return;
    timer.current = setTimeout(() => go({ q }), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          go({ q });
        }}
        className="min-w-0 flex-1"
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-zinc-300 px-3 text-base outline-none focus:border-blue-600"
        />
      </form>
      {showToggle && (
        <label className="flex h-12 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-blue-50">
          <input type="checkbox" checked={includeDormant} onChange={(e) => go({ dormant: e.target.checked })} className="h-4 w-4 accent-blue-600" />
          휴면 품목 포함
        </label>
      )}
    </div>
  );
}
