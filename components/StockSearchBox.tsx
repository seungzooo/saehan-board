"use client";

import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Spinner from "./Spinner";

/**
 * 재고 검색창 — 상단 고정, 높이 56px, 자동 포커스. 입력 후 300ms 자동 검색, 엔터는 즉시.
 * "휴면 품목 포함": 상태는 주소(?dormant=1)에 저장 → 새로고침해도 유지.
 * 누르는 즉시 체크가 바뀌고(useOptimistic) 서버 응답을 기다리는 동안 되돌아가지 않는다. 연속으로 눌러도 마지막 상태가 남는다.
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
  const [pending, startTransition] = useTransition();
  const [dormant, setDormant] = useOptimistic(includeDormant);
  const wantDormant = useRef(includeDormant); // 연속 클릭 시 가장 최근 의도
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function go(value: string, nextDormant = wantDormant.current) {
    const v = value.trim();
    const p = new URLSearchParams();
    if (v) p.set("q", v);
    if (nextDormant) p.set("dormant", "1");
    const s = p.toString();
    startTransition(() => {
      setDormant(nextDormant);
      router.replace(s ? `${basePath}?${s}` : basePath, { scroll: false });
    });
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
        <button
          type="submit"
          aria-busy={pending}
          data-testid="search-button"
          className="flex h-14 w-20 shrink-0 items-center justify-center gap-1 rounded-lg bg-blue-600 text-base font-semibold text-white"
        >
          {pending ? <Spinner label="검색 중" /> : "검색"}
        </button>
      </div>
      <label className="mt-1 inline-flex min-h-10 cursor-pointer select-none items-center gap-2 pr-2 text-sm text-zinc-700" data-testid="dormant-label">
        <input
          type="checkbox"
          checked={dormant}
          onChange={(e) => {
            wantDormant.current = e.target.checked;
            go(q, e.target.checked);
          }}
          className="h-5 w-5 accent-blue-600"
          data-testid="dormant-toggle"
        />
        휴면 품목 포함
        {pending && (
          <span className="text-zinc-500" data-testid="search-pending">
            <Spinner label="적용 중" />
          </span>
        )}
      </label>
    </form>
  );
}
