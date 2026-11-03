"use client";

import { SampleBadge } from "@/lib/stockDisplay";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Item = {
  id: string;
  kindKey: string;
  kind: string;
  fileName: string;
  rowCount: number;
  uploadedAt: string;
  uploadedBy: string;
  reverted: boolean;
};
const PAGE = 5;

const KIND_BADGE: Record<string, string> = {
  STOCK: "bg-blue-50 text-blue-700",
  SALES: "bg-orange-50 text-orange-700",
  PRODUCTION: "bg-zinc-100 text-zinc-800",
  PRODUCT: "bg-zinc-50 text-zinc-600 border border-zinc-200",
  CUSTOMER: "bg-zinc-50 text-zinc-600 border border-zinc-200",
};

/** 업로드 이력 표 — 시각·종류·파일·행수·입력자. 행을 누르면 업로드 상세. 기본 5건 + 더 보기 */
export default function RecentUploads({ items }: { items: Item[] }) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const shown = expanded ? items : items.slice(0, PAGE);
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold">업로드 이력</h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-3 text-sm text-zinc-500">업로드 이력이 없습니다.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <table className="num w-full table-fixed text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="w-[5.5rem] px-2 py-2 text-left font-medium">시각</th>
                  <th className="w-[4.5rem] px-2 py-2 text-left font-medium">종류</th>
                  <th className="px-2 py-2 text-left font-medium">파일</th>
                  <th className="w-14 px-2 py-2 text-right font-medium">행수</th>
                  <th className="hidden w-16 px-2 py-2 text-right font-medium sm:table-cell">입력자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {shown.map((b) => (
                  <tr
                    key={b.id}
                    tabIndex={0}
                    role="link"
                    onClick={() => router.push(`/upload/${b.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && router.push(`/upload/${b.id}`)}
                    className={`cursor-pointer hover:bg-blue-50 focus:bg-blue-50 focus:outline-none ${b.reverted ? "text-zinc-400" : ""}`}
                  >
                    <td className="px-2 py-3 text-xs">{b.uploadedAt.slice(5)}</td>
                    <td className="px-2 py-3">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND_BADGE[b.kindKey] ?? KIND_BADGE.PRODUCT}`}>{b.kind}</span>
                    </td>
                    <td className="truncate px-2 py-3">
                      <span className={b.reverted ? "line-through" : ""}>{b.fileName}</span>
                      <SampleBadge fileName={b.fileName} />
                      {b.reverted && <span className="ml-1 text-xs">취소됨</span>}
                    </td>
                    <td className="px-2 py-3 text-right">{b.rowCount.toLocaleString()}</td>
                    <td className="hidden truncate px-2 py-3 text-right text-xs sm:table-cell">{b.uploadedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length > PAGE && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 h-12 w-full rounded-lg border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-blue-50"
            >
              {expanded ? "접기" : `더 보기 (${items.length - PAGE}건)`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
