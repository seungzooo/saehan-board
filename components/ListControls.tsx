"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Spinner from "./Spinner";

/**
 * 목록 안 검색 + "휴면 품목 포함" 토글. 바꾸면 page를 지워 1페이지로 돌아간다. 다른 쿼리(view 등)는 유지.
 * 토글은 주소(?dormant=1)에 저장되고, 누르는 즉시 체크가 바뀐다(useOptimistic). 서버 응답 중에는 로딩 표시.
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
  const [pending, startTransition] = useTransition();
  const [dormant, setDormant] = useOptimistic(includeDormant);
  const wantDormant = useRef(includeDormant);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(next: { q?: string; dormant?: boolean }) {
    const p = new URLSearchParams(sp.toString());
    p.delete("page");
    const nq = (next.q ?? q).trim();
    if (nq) p.set(queryParam, nq);
    else p.delete(queryParam);
    const nd = next.dormant ?? wantDormant.current;
    if (nd) p.set("dormant", "1");
    else p.delete("dormant");
    const s = p.toString();
    startTransition(() => {
      setDormant(nd);
      router.replace(s ? `${path}?${s}` : path, { scroll: false });
    });
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
        className="relative min-w-0 flex-1"
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-busy={pending}
          autoComplete="off"
          className="h-12 w-full rounded-lg border border-zinc-300 px-3 pr-10 text-base outline-none focus:border-blue-600"
        />
        {pending && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-blue-600" data-testid="list-pending">
            <Spinner label="적용 중" />
          </span>
        )}
      </form>
      {showToggle && (
        <label
          className="flex h-12 shrink-0 cursor-pointer select-none items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-blue-50"
          data-testid="list-dormant-label"
        >
          <input
            type="checkbox"
            checked={dormant}
            onChange={(e) => {
              wantDormant.current = e.target.checked;
              go({ dormant: e.target.checked });
            }}
            className="h-5 w-5 accent-blue-600"
            data-testid="list-dormant-toggle"
          />
          휴면 품목 포함
        </label>
      )}
    </div>
  );
}
