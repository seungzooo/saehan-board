"use client";

import type { AdjustmentItem, OpenOrder } from "@/lib/adjust";
import { REASON_LABEL, type AvailableStock } from "@/lib/availableStock";
import { formatShort } from "@/lib/format";
import { availableText, productInfoText } from "@/lib/stockDisplay";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { cancelAdjustmentAction, createAdjustmentAction, listOpenOrdersAction, searchProductsAction, type ProductHit } from "./actions";

/**
 * 3터치 흐름: ① 품목 탭 → ② 수량 입력 → ③ 저장.
 * 사유는 기본 "출고"라 바꿀 때만 탭한다. 메모는 선택.
 * 출고일 때 미이행 수주가 있으면 "어느 수주 건인지" 선택 — 연결하면 그 수주 차감이 해제된다(이중 차감 방지).
 */
const REASONS = [
  { value: "SHIPMENT", label: "출고" },
  { value: "DEFECT", label: "불량" },
  { value: "ORDER", label: "수주" },
  { value: "OTHER", label: "기타" },
] as const;
type Reason = (typeof REASONS)[number]["value"];

export default function AdjustForm({
  preselected,
  initialOpenOrders,
  initialRecent,
}: {
  preselected: ProductHit | null;
  initialOpenOrders: OpenOrder[];
  initialRecent: AdjustmentItem[];
}) {
  const [product, setProduct] = useState<ProductHit | null>(preselected);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<Reason>("SHIPMENT");
  const [memo, setMemo] = useState("");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>(initialOpenOrders);
  const [orderId, setOrderId] = useState<number | "">("");
  const [recent, setRecent] = useState(initialRecent);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string; stock?: AvailableStock } | null>(null);
  const [pending, startTransition] = useTransition();
  const qtyRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 품목 검색 (300ms 디바운스) — onChange에서 타이머로 처리
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string) {
    setQ(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const v = value.trim();
    if (!v) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        setHits(await searchProductsAction(v));
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  async function loadOrders(code: string) {
    const list = await listOpenOrdersAction(code);
    setOpenOrders(list);
    setOrderId("");
  }

  function pick(p: ProductHit) {
    setProduct(p);
    setFlash(null);
    setOpenOrders([]);
    setOrderId("");
    void loadOrders(p.code);
    setTimeout(() => qtyRef.current?.focus(), 0);
  }

  function changeProduct() {
    setProduct(null);
    setQ("");
    setHits([]);
    setOpenOrders([]);
    setOrderId("");
    setFlash(null);
    setTimeout(() => searchRef.current?.focus(), 0);
  }

  function pickOrder(o: OpenOrder) {
    setOrderId(o.id);
    if (!qty) setQty(String(o.qtyBox));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      setFlash({ kind: "err", text: "수량은 1 이상의 정수로 입력하세요." });
      return;
    }
    const linked = reason === "SHIPMENT" && orderId !== "" ? orderId : null;
    startTransition(async () => {
      const r = await createAdjustmentAction({ productCode: product.code, qtyBox: n, reason, memo, orderId: linked });
      if (!r.ok) {
        setFlash({ kind: "err", text: r.message });
        return;
      }
      setRecent((list) => [r.item, ...list].slice(0, 50));
      setFlash({
        kind: "ok",
        text: `${product.name} ${REASON_LABEL[reason]} −${n.toLocaleString()} 저장${linked ? " (수주 차감 해제)" : ""}`,
        stock: r.stock,
      });
      setQty("");
      setMemo("");
      await loadOrders(product.code);
      qtyRef.current?.focus();
    });
  }

  function cancel(item: AdjustmentItem) {
    const label = REASON_LABEL[item.reason as keyof typeof REASON_LABEL] ?? item.reason;
    if (!window.confirm(`${item.productName} ${label} −${item.qtyBox} 변동을 취소할까요?`)) return;
    startTransition(async () => {
      const r = await cancelAdjustmentAction(item.id);
      if (!r.ok) {
        setFlash({ kind: "err", text: r.message });
        return;
      }
      setRecent((list) => list.map((x) => (x.id === r.item.id ? r.item : x)));
      setFlash({ kind: "ok", text: `취소됨 — ${item.productName} 가용재고 ${availableText(r.stock)}`, stock: r.stock });
      if (product && product.code === item.productCode) await loadOrders(product.code);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ① 품목 */}
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        {product ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{product.name}</p>
              <p className="truncate text-xs text-zinc-500">{productInfoText(product)}</p>
            </div>
            <button type="button" onClick={changeProduct} className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-sm">
              변경
            </button>
          </div>
        ) : (
          <>
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="품목명 또는 품번"
              autoFocus
              autoComplete="off"
              className="h-12 w-full rounded-lg border border-zinc-300 px-4 text-base outline-none focus:border-blue-500"
            />
            {q.trim() && (
              <ul className="mt-2 max-h-72 divide-y divide-zinc-100 overflow-y-auto">
                {hits.length === 0 && !searching && <li className="py-3 text-sm text-zinc-500">검색 결과 없음</li>}
                {hits.map((h) => (
                  <li key={h.code}>
                    <button type="button" onClick={() => pick(h)} className="flex w-full flex-col items-start px-1 py-3 text-left active:bg-zinc-50">
                      <span className="font-medium">{h.name}</span>
                      <span className="text-xs text-zinc-500">{productInfoText(h)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* ② 수량 · 사유 · ③ 저장 */}
      {product && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-600">수량 (박스)</span>
            <input
              ref={qtyRef}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              className="h-14 rounded-lg border border-zinc-300 px-4 text-2xl font-semibold tabular-nums outline-none focus:border-blue-500"
            />
          </label>
          <div role="radiogroup" aria-label="사유" className="grid grid-cols-4 gap-2">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={reason === r.value}
                onClick={() => setReason(r.value)}
                className={`h-12 rounded-lg border text-base font-medium ${
                  reason === r.value ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 bg-white text-zinc-700"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {reason === "SHIPMENT" && openOrders.length > 0 && (
            <fieldset className="rounded-md bg-zinc-50 p-3 text-sm">
              <legend className="text-zinc-700">어느 수주 건인가요? (연결하면 그 수주 차감이 해제됩니다)</legend>
              <div className="mt-2 flex flex-col gap-1">
                <label className={`flex h-10 items-center rounded-md border px-3 ${orderId === "" ? "border-blue-600 bg-white" : "border-zinc-200 bg-white"}`}>
                  <input type="radio" name="orderId" checked={orderId === ""} onChange={() => setOrderId("")} className="mr-2" />
                  수주와 무관한 출고
                </label>
                {openOrders.map((o) => (
                  <label
                    key={o.id}
                    className={`flex h-10 items-center rounded-md border px-3 ${orderId === o.id ? "border-blue-600 bg-white" : "border-zinc-200 bg-white"}`}
                  >
                    <input type="radio" name="orderId" checked={orderId === o.id} onChange={() => pickOrder(o)} className="mr-2" />
                    수주 {o.qtyBox.toLocaleString()}박스 · {formatShort(o.createdAt)}
                    {o.memo && ` · ${o.memo}`}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={reason === "ORDER" ? "메모 (거래처·납기 등, 선택)" : "메모 (선택)"}
            maxLength={200}
            className="h-11 rounded-lg border border-zinc-300 px-4 text-sm outline-none focus:border-blue-500"
          />
          <button type="submit" disabled={pending || !qty} className="h-14 rounded-lg bg-blue-600 text-lg font-bold text-white disabled:bg-zinc-300">
            {pending ? "저장 중…" : "저장"}
          </button>
        </form>
      )}

      {flash && (
        <div
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            flash.kind === "ok" ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          <p className="font-medium">{flash.text}</p>
          {flash.stock && (
            <p className="mt-1">
              가용재고 <span className="text-xl font-bold tabular-nums">{availableText(flash.stock)}</span>
              {flash.stock.available !== null && " 박스"}
              {product && (
                <>
                  {" · "}
                  <Link href={`/stock/${encodeURIComponent(product.code)}`} className="text-blue-700 underline">
                    상세
                  </Link>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* 최근 변동 */}
      <section>
        <h2 className="mb-2 text-base font-semibold">최근 변동</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 변동 입력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {recent.map((it) => {
              const cancelled = !!it.cancelledAt;
              return (
                <li key={it.id} className={`flex items-center gap-2 px-3 py-2 ${cancelled ? "text-zinc-400" : ""}`}>
                  <div className={`min-w-0 flex-1 ${cancelled ? "line-through" : ""}`}>
                    <p className="truncate font-medium">{it.productName}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {REASON_LABEL[it.reason as keyof typeof REASON_LABEL] ?? it.reason} −{it.qtyBox.toLocaleString()}
                      {it.orderId != null && ` · 수주 #${it.orderId} 이행`}
                      {it.memo && ` · ${it.memo}`} · {formatShort(it.createdAt)} {it.createdBy}
                    </p>
                  </div>
                  {cancelled ? (
                    <span className="shrink-0 text-xs">취소됨</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => cancel(it)}
                      disabled={pending}
                      className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-xs text-zinc-700"
                    >
                      취소
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
