"use client";

import { boxInputAllowed, copyText, judgeRequest, type QtyUnit, type StockForRequest } from "@/lib/request";
import { useState } from "react";

/** 품목 상세: 요청 수량(개/박스) → "요청 100개 · 현재 90개 · 10개 부족" 즉시 표시 + 복사 문구 */
export default function RequestCalculator({ stock }: { stock: StockForRequest }) {
  const [qty, setQty] = useState("");
  const allowBox = boxInputAllowed(stock.packUnit, stock.unitsPerBox);
  const [unit, setUnit] = useState<QtyUnit>("EA");
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const j = judgeRequest(stock, qty, unit);
  const text = copyText(stock, j);
  const tone =
    j.kind === "OK" ? "border-zinc-300 text-zinc-900" : j.kind === "SHORT" ? "border-red-300 bg-red-50 text-red-800" : j.kind === "HOLD" || j.kind === "CHECK" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-zinc-200 text-zinc-500";

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  return (
    <section data-testid="request-calc" className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3">
      <h2 className="text-base font-semibold">요청 수량 계산</h2>
      <div className="flex gap-2">
        <input
          data-testid="request-qty"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-label="요청 수량"
          placeholder="0"
          value={qty === "" ? "" : Number(qty).toLocaleString()}
          onChange={(e) => {
            setQty(e.target.value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "").slice(0, 9));
            setCopied(null);
          }}
          className="num h-12 min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 text-xl font-semibold outline-none focus:border-blue-500"
        />
        <div role="radiogroup" aria-label="단위" className="flex shrink-0 overflow-hidden rounded-lg border border-zinc-300">
          {(["EA", "BOX"] as const).map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={unit === u}
              disabled={u === "BOX" && !allowBox}
              onClick={() => {
                setUnit(u);
                setCopied(null);
              }}
              className={`h-12 w-14 text-base ${unit === u ? "bg-blue-600 font-semibold text-white" : "bg-white text-zinc-700"} disabled:bg-zinc-100 disabled:text-zinc-300`}
            >
              {u === "EA" ? "개" : "박스"}
            </button>
          ))}
        </div>
      </div>
      {!allowBox && <p className="text-xs text-zinc-500">박스 입수가 없어 개 단위로만 계산합니다.</p>}
      <p data-testid="request-result" data-kind={j.kind} aria-live="polite" className={`num rounded-md border px-3 py-2 text-base font-semibold ${tone}`}>
        {j.line}
      </p>
      <p className="text-xs text-zinc-500">확인 재고 기준 — 출고 예약·납기를 확정한 것이 아닙니다.</p>
      <button
        type="button"
        data-testid="copy-button"
        disabled={j.kind === "EMPTY" || j.kind === "INVALID"}
        onClick={copy}
        className="h-11 rounded-lg border border-zinc-300 bg-white text-sm font-medium hover:bg-blue-50 disabled:text-zinc-300"
      >
        {copied === "ok" ? "복사됨" : "결과 문구 복사"}
      </button>
      {copied === "fail" && <p className="text-xs text-red-700">복사하지 못했습니다. 아래 문구를 길게 눌러 복사하세요.</p>}
      {j.kind !== "EMPTY" && j.kind !== "INVALID" && (
        <pre data-testid="copy-text" className="whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs text-zinc-700">
          {text}
        </pre>
      )}
    </section>
  );
}
