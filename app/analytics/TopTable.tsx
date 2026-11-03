"use client";

/**
 * 특정 달에 출고가 몰리는 품목 TOP 10 — 품명 / 집중된 달 / 평소 월평균의 몇 배 / 현재 재고 상태.
 * 행의 "근거 보기"(또는 재고 칸의 안내)를 누르면 바로 아래에 하나만 펼친다.
 */
import { peakPattern, type PeakEvidence } from "@/lib/analytics/explain";
import type { StockCell } from "@/lib/analytics/stockCell";
import Link from "next/link";
import { Fragment, useState } from "react";

export type TopRowView = {
  code: string;
  name: string;
  peakMonth: number;
  peakIndex: number;
  unitLabel: string;
  evidence: PeakEvidence;
  stock: StockCell;
};

const n = (v: number) => Math.round(v).toLocaleString("ko-KR");

export default function TopTable({ rows }: { rows: TopRowView[] }) {
  const [open, setOpen] = useState<{ code: string; what: "why" | "stock" } | null>(null);
  const toggle = (code: string, what: "why" | "stock") => setOpen((cur) => (cur?.code === code && cur.what === what ? null : { code, what }));
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200" data-testid="top-table">
      <table className="num w-full table-fixed text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-500">
          <tr>
            <th className="px-2 py-2 text-left font-medium">품명</th>
            <th className="w-12 px-1 py-2 text-right font-medium">집중된 달</th>
            <th className="w-16 px-1 py-2 text-right font-medium">평소의</th>
            <th className="w-[7.5rem] px-2 py-2 text-right font-medium sm:w-56">현재 재고</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {rows.map((r) => {
            const pat = peakPattern(r.evidence);
            const isOpen = open?.code === r.code;
            return (
              <Fragment key={r.code}>
                <tr data-testid="top-row" data-code={r.code} className={isOpen ? "bg-blue-50/60" : ""}>
                  <td className="px-2 py-2 align-top">
                    <Link href={`/analytics?code=${encodeURIComponent(r.code)}`} className="block truncate font-medium text-zinc-900 hover:underline">
                      {r.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                      {r.code}
                      {pat.badge && <span className="rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800" data-testid="repeat-badge">반복 성수기</span>}
                      {pat.kind === "spike" && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">한 해 집중</span>}
                      <button
                        type="button"
                        className="min-h-8 px-1 text-blue-700 underline"
                        aria-expanded={isOpen && open?.what === "why"}
                        data-testid="why-button"
                        onClick={() => toggle(r.code, "why")}
                      >
                        근거 보기
                      </button>
                    </span>
                  </td>
                  <td className="px-1 py-2 text-right align-top">{r.peakMonth}월</td>
                  <td className="px-1 py-2 text-right align-top font-semibold text-blue-800">{r.peakIndex.toFixed(1)}배</td>
                  <td className="px-2 py-2 text-right align-top text-xs">
                    <button
                      type="button"
                      data-testid="stock-cell"
                      data-state={r.stock.state}
                      aria-expanded={isOpen && open?.what === "stock"}
                      onClick={() => toggle(r.code, "stock")}
                      className={`w-full text-right ${r.stock.tone}`}
                    >
                      <span className="block font-semibold">{r.stock.text}</span>
                      {r.stock.sub && <span className="block text-zinc-500">{r.stock.sub}</span>}
                      {r.stock.days && <span className="block text-zinc-600">{r.stock.days.text}</span>}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr data-testid={open?.what === "why" ? "why-detail" : "stock-detail"}>
                    <td colSpan={4} className="bg-blue-50 px-3 py-2 text-sm text-blue-950">
                      {open?.what === "why" ? <Evidence row={r} pat={pat} /> : <StockDetail cell={r.stock} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Evidence({ row, pat }: { row: TopRowView; pat: ReturnType<typeof peakPattern> }) {
  const e = row.evidence;
  const u = row.unitLabel;
  return (
    <div className="flex flex-col gap-1">
      <p className="font-semibold">{pat.label}</p>
      <p>
        평소 = 분석 기간 전체의 월평균 {n(e.overallMean)}
        {u}. {e.month}월 5년 평균 {n(e.monthMean)}
        {u} → 평소의 {row.peakIndex.toFixed(2)}배.
      </p>
      <table className="num mt-1 w-full max-w-md text-xs">
        <thead className="text-zinc-600">
          <tr>
            <th className="py-1 text-left font-medium">연도</th>
            <th className="py-1 text-right font-medium">{e.month}월 출고</th>
            <th className="py-1 text-right font-medium">그해 월평균</th>
            <th className="py-1 text-right font-medium">평균 초과</th>
          </tr>
        </thead>
        <tbody>
          {e.years.map((y) => (
            <tr key={y.year}>
              <td className="py-0.5">
                {y.year}년{!y.complete && <span className="text-zinc-500"> (일부 달)</span>}
              </td>
              <td className="py-0.5 text-right">
                {n(y.value)}
                {u}
              </td>
              <td className="py-0.5 text-right">
                {n(y.yearMean)}
                {u}
              </td>
              <td className="py-0.5 text-right">{!y.complete || y.yearMean === 0 ? "비교 제외" : y.value > y.yearMean ? "예" : "아니오"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs">
        평균을 넘은 연도 {pat.over} / 비교 가능한 연도 {pat.comparable} (일부 달만 있는 해·그해 출고 0인 해는 분모에서 제외). {pat.comparable} 중 4개 해 이상이면 &ldquo;반복 성수기&rdquo;.
      </p>
    </div>
  );
}

function StockDetail({ cell }: { cell: StockCell }) {
  return (
    <div className="flex flex-col gap-1">
      {cell.reasons.map((r) => (
        <p key={r}>{r}</p>
      ))}
      {cell.actions.map((a) => (
        <Link key={a.href} href={a.href} className="font-semibold text-blue-700 underline">
          {a.label}
        </Link>
      ))}
    </div>
  );
}
