"use client";

import type { UploadKind } from "@/config/excel-mapping";
import type { UploadResponse } from "@/lib/excel/upload";
import { formatDateTime } from "@/lib/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { uploadAction } from "./actions";

const TABS: { kind: UploadKind; label: string; hint: string }[] = [
  { kind: "STOCK", label: "재고", hint: "ERP 재고 엑셀. 필수 컬럼: 품번, 재고수량 (박스 단위). 품명/규격은 선택. 컬럼명에 괄호·단위가 붙어도 됩니다 — 예: 재고수량(박스), 품 번" },
  { kind: "PRODUCTION", label: "생산실적", hint: "팀별 파일(1211·1212·1219)을 각각 올리세요. 이미 있는 행(같은 생산일자·품번·작업지시번호·조·호기·전표구분)은 건너뜁니다." },
  { kind: "SALES", label: "출고실적", hint: "연도별 판매실적 파일. 이미 있는 행(같은 출고일자·품번·전표번호)은 건너뜁니다." },
  { kind: "PRODUCT", label: "제품 마스터", hint: "품번 / 품명/규격 / 포장단위수량 / 가로·세로·높이(mm)" },
  { kind: "CUSTOMER", label: "거래처", hint: "거래선 / 구분(B2B·B2C) / 주문단위(차량·박스)" },
];


export default function UploadForm({ initialKind }: { initialKind: UploadKind }) {
  const [kind, setKind] = useState<UploadKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
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
        router.refresh(); // 서버 렌더된 "최근 업로드" 목록·기준 시각 갱신
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

      {result && <ResultCard r={result} kind={kind} />}
    </div>
  );
}

/** 업로드 종류별 한 줄 요약 — "재고 60개 품목 갱신, 기준 시각 04:35" */
function summarize(kind: UploadKind, r: Extract<UploadResponse, { status: "saved" }>): string {
  const x = r.result;
  const n = (v: number) => v.toLocaleString();
  const time = formatDateTime(r.uploadedAt).slice(11);
  switch (kind) {
    case "STOCK":
      return `재고 ${n(x.inserted)}개 품목 갱신${x.newProducts ? ` (신규 품목 ${n(x.newProducts)})` : ""}, 기준 시각 ${time}`;
    case "SALES":
    case "PRODUCTION":
      return `${kind === "SALES" ? "출고" : "생산"}실적 ${n(x.inserted)}행 추가${x.duplicates ? `, 이미 있던 ${n(x.duplicates)}행 건너뜀` : ""}${
        x.period ? ` (${x.period.from} ~ ${x.period.to})` : ""
      }`;
    case "PRODUCT":
      return `제품 신규 ${n(x.newProducts)}, 갱신 ${n(x.updated ?? 0)}`;
    case "CUSTOMER":
      return `거래처 신규 ${n(x.newCustomers)}, 갱신 ${n(x.updated ?? 0)}`;
  }
}

function NextAction({ kind }: { kind: UploadKind }) {
  const btn = "inline-flex h-11 items-center rounded-md px-4 text-sm font-semibold";
  if (kind === "STOCK" || kind === "PRODUCT") {
    return (
      <Link href="/stock" className={`${btn} bg-zinc-900 text-white`}>
        재고 확인하기 →
      </Link>
    );
  }
  if (kind === "SALES" || kind === "PRODUCTION") {
    return (
      <button type="button" disabled className={`${btn} cursor-not-allowed bg-zinc-200 text-zinc-500`} title="F5 추이 분석 구현 후 열립니다">
        추이 보기 → (준비 중)
      </button>
    );
  }
  return null;
}

function ResultCard({ r, kind }: { r: UploadResponse; kind: UploadKind }) {
  if (r.status === "saved") {
    const x = r.result;
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
        <p className="text-base font-semibold text-green-800">{summarize(kind, r)}</p>
        <ul className="mt-2 space-y-1 text-green-900">
          <li>
            업로드 시각: {formatDateTime(r.uploadedAt)} · {(r.elapsedMs / 1000).toFixed(1)}초 · {r.format}
          </li>
          <li>
            신규 {(x.newProducts + x.newCustomers).toLocaleString()} · 갱신 {(x.updated ?? 0).toLocaleString()} · 중복 건너뜀{" "}
            {(x.duplicates ?? 0).toLocaleString()} · 빈 행/오류 건너뜀 {x.skipped.toLocaleString()}
          </li>
          {x.note && <li>{x.note}</li>}
        </ul>
        <div className="mt-3">
          <NextAction kind={kind} />
        </div>
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
