"use client";

import type { UploadKind } from "@/config/excel-mapping";
import type { UploadResponse } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import { useRef, useState, useTransition } from "react";
import { uploadAction } from "./actions";

const TABS: { kind: UploadKind; label: string; hint: string }[] = [
  { kind: "STOCK", label: "재고", hint: "ERP 재고 엑셀. 필수 컬럼: 품번, 재고수량 (박스 단위). 품명/규격은 선택. 컬럼명에 괄호·단위가 붙어도 됩니다 — 예: 재고수량(박스), 품 번" },
  { kind: "PRODUCTION", label: "생산실적", hint: "팀별 파일(1211·1212·1219)을 각각 올리세요" },
  { kind: "SALES", label: "출고실적", hint: "연도별 판매실적 파일" },
  { kind: "PRODUCT", label: "제품 마스터", hint: "품번 / 품명/규격 / 포장단위수량 / 가로·세로·높이(mm)" },
  { kind: "CUSTOMER", label: "거래처", hint: "거래선 / 구분(B2B·B2C) / 주문단위(차량·박스)" },
];


export default function UploadForm({ initialKind }: { initialKind: UploadKind }) {
  const [kind, setKind] = useState<UploadKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const tab = TABS.find((t) => t.kind === kind)!;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    setResult(null);
    startTransition(async () => {
      const res = await uploadAction(fd);
      setResult(res);
      if (res.status === "saved") {
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.kind}
            role="tab"
            type="button"
            aria-selected={kind === t.kind}
            onClick={() => {
              setKind(t.kind);
              setResult(null);
            }}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
              kind === t.kind ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">{tab.hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,.csv,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
        <button
          type="submit"
          disabled={!file || pending}
          className="h-12 rounded-md bg-blue-600 text-base font-semibold text-white disabled:bg-zinc-300"
        >
          {pending ? "업로드 중…" : `${tab.label} 업로드`}
        </button>
      </form>

      {result && <ResultCard r={result} />}
    </div>
  );
}

function ResultCard({ r }: { r: UploadResponse }) {
  if (r.status === "saved") {
    const x = r.result;
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
        <p className="font-semibold text-green-800">
          저장 완료 — {x.inserted.toLocaleString()}행 ({(r.elapsedMs / 1000).toFixed(1)}초)
        </p>
        <ul className="mt-2 space-y-1 text-green-900">
          <li>업로드 시각: {formatDateTime(r.uploadedAt)}</li>
          <li>파일 형식: {r.format}</li>
          {x.period && (
            <li>
              기간: {x.period.from} ~ {x.period.to}
            </li>
          )}
          {x.newProducts > 0 && <li>신규 품목 {x.newProducts}개 생성</li>}
          {x.newCustomers > 0 && <li>신규 거래처 {x.newCustomers}곳 생성</li>}
          {x.skipped > 0 && <li>건너뛴 행 {x.skipped}</li>}
          {x.note && <li>{x.note}</li>}
        </ul>
        {x.errors.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-red-700">오류 행 {x.errors.length}건 보기</summary>
            <ul className="mt-1 list-disc pl-5 text-red-800">
              {x.errors.map((e) => (
                <li key={e.row}>
                  {e.row}행: {e.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }
  if (r.status === "duplicate") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">이미 업로드된 파일입니다. 다시 저장하지 않았습니다.</p>
        <p className="mt-1">
          {r.fileName} · {formatDateTime(r.uploadedAt)}
        </p>
      </div>
    );
  }
  if (r.status === "mapping-error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">컬럼이 맞지 않아 저장하지 않았습니다.</p>
        <p className="mt-2">찾지 못한 필수 컬럼 (아래 이름 중 하나를 포함하는 헤더가 있어야 합니다. 공백·괄호·단위는 무시):</p>
        <ul className="list-disc pl-5">
          {r.missing.map((m) => (
            <li key={m} className="font-mono">
              {m}
            </li>
          ))}
        </ul>
        <p className="mt-2">파일의 헤더 ({r.format}):</p>
        <p className="break-all font-mono text-xs">{r.headerFound.join(" | ")}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-semibold">업로드 실패</p>
      <p className="mt-1 break-all">{r.message}</p>
    </div>
  );
}
