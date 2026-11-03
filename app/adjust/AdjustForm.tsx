"use client";

import type { AdjustmentItem, OpenOrder } from "@/lib/adjust";
import { REASON_LABEL, type AvailableStock } from "@/lib/availableStock";
import { formatShort } from "@/lib/format";
import { availableText, productInfoText } from "@/lib/stockDisplay";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import {
  cancelAdjustmentAction,
  correctAdjustmentAction,
  createAdjustmentAction,
  getStockAction,
  listOpenOrdersAction,
  searchProductsAction,
  type ProductHit,
} from "./actions";

/**
 * 3터치 흐름: ① 품목 탭 → ② 수량 입력 → ③ 저장.
 * - 품목을 고르면 현재 재고를 불러와 "현재 30박스 → 출고 20 → 반영 후 10박스"를 보여준다.
 * - 사유는 기본 "출고". 출고일 때 미이행 수주가 있으면 "어느 수주 건인지" 선택 — 연결하면 그 수주 차감이 해제된다.
 * - 저장은 폼마다 발급한 요청 ID로 멱등 처리 (연타·동시 입력 시 한 건만 저장).
 * - 정정: 원기록은 그대로 두고 정정 기록(누가·언제·왜·얼마)을 추가한다.
 */
const REASONS = [
  { value: "SHIPMENT", label: "출고" },
  { value: "DEFECT", label: "불량" },
  { value: "ORDER", label: "수주" },
  { value: "OTHER", label: "기타" },
] as const;
type Reason = (typeof REASONS)[number]["value"];

function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export default function AdjustForm({
  preselected,
  initialStock,
  initialOpenOrders,
  initialRecent,
}: {
  preselected: ProductHit | null;
  initialStock: AvailableStock | null;
  initialOpenOrders: OpenOrder[];
  initialRecent: AdjustmentItem[];
}) {
  const [product, setProduct] = useState<ProductHit | null>(preselected);
  const [stock, setStock] = useState<AvailableStock | null>(initialStock);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<Reason>("SHIPMENT");
  const [memo, setMemo] = useState("");
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>(initialOpenOrders);
  const [orderId, setOrderId] = useState<number | "">("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [recent, setRecent] = useState(initialRecent);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string; stock?: AvailableStock } | null>(null);
  const [correcting, setCorrecting] = useState<AdjustmentItem | null>(null);
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

  async function loadProductState(code: string) {
    const [s, list] = await Promise.all([getStockAction(code), listOpenOrdersAction(code)]);
    setStock(s);
    setOpenOrders(list);
    setOrderId("");
  }

  function pick(p: ProductHit) {
    setProduct(p);
    setStock(null);
    setFlash(null);
    setOpenOrders([]);
    setOrderId("");
    void loadProductState(p.code);
    setTimeout(() => qtyRef.current?.focus(), 0);
  }

  function changeProduct() {
    setProduct(null);
    setStock(null);
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

  // "현재 30박스 → 출고 20 → 반영 후 10박스" 미리 계산 (수주 연결 시 해당 수주 차감이 풀리는 것까지)
  const n = Number(qty);
  const validQty = Number.isInteger(n) && n > 0;
  const linkedOrder = reason === "SHIPMENT" && orderId !== "" ? openOrders.find((o) => o.id === orderId) : undefined;
  const after = stock && stock.available !== null && validQty ? stock.available - n + (linkedOrder?.qtyBox ?? 0) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product || pending) return;
    if (!validQty) {
      setFlash({ kind: "err", text: "수량은 1 이상의 정수로 입력하세요." });
      return;
    }
    const linked = reason === "SHIPMENT" && orderId !== "" ? orderId : null;
    const rid = requestId;
    startTransition(async () => {
      const r = await createAdjustmentAction({ productCode: product.code, qtyBox: n, reason, memo, orderId: linked, requestId: rid });
      if (!r.ok) {
        setFlash({ kind: "err", text: r.message });
        return;
      }
      setRequestId(newRequestId()); // 다음 입력은 새 요청 ID
      setRecent((list) => (list.some((x) => x.id === r.item.id) ? list : [r.item, ...list].slice(0, 50)));
      setStock(r.stock);
      setFlash({
        kind: "ok",
        text: `${product.name} ${REASON_LABEL[reason]} −${n.toLocaleString()} 저장${linked ? " (수주 차감 해제)" : ""}${r.deduped ? " · 중복 요청은 한 건만 저장됨" : ""}`,
        stock: r.stock,
      });
      setQty("");
      setMemo("");
      await loadProductState(product.code);
      qtyRef.current?.focus();
    });
  }

  function cancel(item: AdjustmentItem) {
    const label = REASON_LABEL[item.reason as keyof typeof REASON_LABEL] ?? item.reason;
    if (!window.confirm(`${item.productName} ${label} ${item.qtyBox > 0 ? "−" : "+"}${Math.abs(item.qtyBox)} 변동을 취소할까요?`)) return;
    startTransition(async () => {
      const r = await cancelAdjustmentAction(item.id);
      if (!r.ok) {
        setFlash({ kind: "err", text: r.message });
        return;
      }
      setRecent((list) => list.map((x) => (x.id === r.item.id || x.correctsId === r.item.id ? { ...x, cancelledAt: r.item.cancelledAt } : x)));
      setFlash({ kind: "ok", text: `취소됨 — ${item.productName} 현재 재고 ${availableText(r.stock)}`, stock: r.stock });
      if (product && product.code === item.productCode) {
        setStock(r.stock);
        await loadProductState(product.code);
      }
    });
  }

  function submitCorrection(item: AdjustmentItem, newQty: number, why: string) {
    const rid = newRequestId();
    startTransition(async () => {
      const r = await correctAdjustmentAction({ id: item.id, newQtyBox: newQty, reason: why, requestId: rid });
      if (!r.ok) {
        setFlash({ kind: "err", text: r.message });
        return;
      }
      setCorrecting(null);
      setRecent((list) => [r.correction, ...list].slice(0, 50));
      setFlash({ kind: "ok", text: `정정됨 — ${item.productName} ${item.qtyBox.toLocaleString()} → ${newQty.toLocaleString()}`, stock: r.stock });
      if (product && product.code === item.productCode) {
        setStock(r.stock);
        await loadProductState(product.code);
      }
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
              <p className="mt-1 text-sm">
                현재 재고{" "}
                <span className="text-lg font-bold tabular-nums">{stock ? availableText(stock) : "…"}</span>
                {stock?.available !== null && stock && <span className="text-zinc-500"> 박스</span>}
              </p>
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

          {/* 현재 → 변동 → 반영 후 */}
          <p data-testid="after-preview" className="rounded-md bg-zinc-50 px-3 py-2 text-sm tabular-nums">
            {stock === null ? (
              "현재 재고를 불러오는 중…"
            ) : stock.available === null ? (
              <span className="text-amber-700">현재 재고 확인 필요 (최근 재고 파일에 없음) — 변동은 기록되며 수량은 다음 파일 반영 후 표시됩니다.</span>
            ) : (
              <>
                현재 <b>{stock.available.toLocaleString()}박스</b>
                {validQty ? (
                  <>
                    {" → "}
                    {REASON_LABEL[reason]} {n.toLocaleString()}
                    {linkedOrder && ` (수주 ${linkedOrder.qtyBox.toLocaleString()} 해제)`}
                    {" → 반영 후 "}
                    <b className={after !== null && after < 0 ? "text-red-600" : ""}>{after?.toLocaleString()}박스</b>
                  </>
                ) : (
                  <span className="text-zinc-500"> → 수량을 입력하면 반영 후 수량이 보입니다</span>
                )}
              </>
            )}
          </p>

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
              현재 재고 <span className="text-xl font-bold tabular-nums">{availableText(flash.stock)}</span>
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

      {correcting && (
        <CorrectionDialog item={correcting} pending={pending} onCancel={() => setCorrecting(null)} onSubmit={(nq, why) => submitCorrection(correcting, nq, why)} />
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
              const isCorrection = it.correctsId != null;
              const corrected = recent.some((x) => x.correctsId === it.id && !x.cancelledAt);
              return (
                <li key={it.id} className={`flex items-center gap-2 px-3 py-2 ${cancelled ? "text-zinc-400" : ""}`}>
                  <Link href={`/adjust/${it.id}`} className={`min-w-0 flex-1 rounded hover:bg-blue-50 ${cancelled ? "line-through" : ""}`}>
                    <p className="truncate font-medium">
                      {it.productName}
                      {isCorrection && <span className="ml-1 rounded bg-blue-100 px-1 text-xs text-blue-800">정정</span>}
                      {corrected && <span className="ml-1 rounded bg-zinc-100 px-1 text-xs text-zinc-700">정정됨</span>}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {REASON_LABEL[it.reason as keyof typeof REASON_LABEL] ?? it.reason} {it.qtyBox > 0 ? "−" : "+"}
                      {Math.abs(it.qtyBox).toLocaleString()}
                      {it.orderId != null && ` · 수주 #${it.orderId} 이행`}
                      {it.correctionReason && ` · 사유: ${it.correctionReason}`}
                      {it.memo && ` · ${it.memo}`} · {formatShort(it.createdAt)} {it.createdBy}
                    </p>
                  </Link>
                  {cancelled ? (
                    <span className="shrink-0 text-xs">취소됨</span>
                  ) : (
                    <div className="flex shrink-0 gap-1">
                      {!isCorrection && (
                        <button
                          type="button"
                          onClick={() => setCorrecting(it)}
                          disabled={pending}
                          className="rounded-md border border-zinc-300 px-2 py-2 text-xs text-zinc-700"
                        >
                          정정
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => cancel(it)}
                        disabled={pending}
                        className="rounded-md border border-zinc-300 px-2 py-2 text-xs text-zinc-700"
                      >
                        취소
                      </button>
                    </div>
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

function CorrectionDialog({
  item,
  pending,
  onCancel,
  onSubmit,
}: {
  item: AdjustmentItem;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (newQty: number, why: string) => void;
}) {
  const [val, setVal] = useState(String(item.qtyBox));
  const [why, setWhy] = useState("");
  const n = Number(val);
  const ok = Number.isInteger(n) && n >= 0 && why.trim().length > 0 && n !== item.qtyBox;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(n, why.trim());
      }}
      className="flex flex-col gap-2 rounded-lg border border-blue-300 bg-blue-50 p-4 text-sm"
    >
      <p className="font-semibold">
        정정: {item.productName} {REASON_LABEL[item.reason as keyof typeof REASON_LABEL] ?? item.reason} {item.qtyBox.toLocaleString()}박스
      </p>
      <p className="text-xs text-blue-900">원기록은 그대로 남고, 차이만큼 정정 기록이 추가됩니다 (누가·언제·왜·얼마).</p>
      <label className="flex items-center gap-2">
        <span className="w-20 shrink-0">새 수량</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-lg tabular-nums"
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="w-20 shrink-0">정정 사유</span>
        <input
          type="text"
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder="예: 전표 수량 오기"
          maxLength={200}
          className="h-11 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!ok || pending} className="h-11 flex-1 rounded-md bg-blue-600 font-semibold text-white disabled:bg-zinc-300">
          {pending ? "저장 중…" : `정정 저장 (${n > item.qtyBox ? "+" : ""}${(n - item.qtyBox).toLocaleString()})`}
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-md border border-zinc-300 bg-white px-4">
          닫기
        </button>
      </div>
    </form>
  );
}
