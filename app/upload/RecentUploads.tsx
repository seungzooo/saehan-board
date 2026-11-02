"use client";

import { useState } from "react";

type Item = { id: string; kind: string; fileName: string; rowCount: number; uploadedAt: string; uploadedBy: string };
const PAGE = 5;

/** 최근 업로드 — 모든 종류, 기본 5건, "더 보기"로 펼침 */
export default function RecentUploads({ items }: { items: Item[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, PAGE);
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">최근 업로드</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">업로드 이력이 없습니다.</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {shown.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-20 shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-center text-xs font-medium">{b.kind}</span>
                <span className="min-w-0 flex-1 truncate">{b.fileName}</span>
                <span className="shrink-0 text-xs text-zinc-500">{b.rowCount.toLocaleString()}행</span>
                <span className="shrink-0 text-right text-xs text-zinc-500">
                  {b.uploadedAt}
                  <br />
                  {b.uploadedBy}
                </span>
              </li>
            ))}
          </ul>
          {items.length > PAGE && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 h-10 w-full rounded-md border border-zinc-300 bg-white text-sm text-zinc-700"
            >
              {expanded ? "접기" : `더 보기 (${items.length - PAGE}건)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
