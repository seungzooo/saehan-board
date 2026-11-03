"use client";

import type { UploadKind } from "@/config/excel-mapping";
import type { RowError } from "@/lib/excel/import";
import type { StockMode, StockPreview, UploadResponse } from "@/lib/excel/upload";
import { formatDateTime, seoulParts } from "@/lib/format";
import { isSampleFileName } from "@/lib/stockDisplay";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { previewStockAction, suggestCompletionAction, uploadAction } from "./actions";

const TABS: { kind: UploadKind; label: string; hint: string }[] = [
  {
    kind: "STOCK",
    label: "재고",
    hint: "ERP 재고 엑셀. 필수 컬럼: 품번, 재고수량 (박스 단위). 품명/규격은 선택. 컬럼명에 괄호·단위가 붙어도 됩니다 — 예: 재고수량(박스), 품 번. 품번은 제품 마스터에 있어야 합니다.",
  },
  {
    kind: "PRODUCTION",
    label: "생산실적",
    hint: "팀별 파일(1211·1212·1219)을 각각 올리세요. 이미 있는 행(같은 생산일자·품번·작업지시번호·조·호기·전표구분)은 건너뜁니다.",
  },
  { kind: "SALES", label: "출고실적", hint: "연도별 판매실적 파일. 이미 있는 행(같은 출고일자·품번·전표번호)은 건너뜁니다." },
  { kind: "PRODUCT", label: "제품 마스터", hint: "품번 / 품명/규격 / 포장단위수량 / 가로·세로·높이(mm)" },
  { kind: "CUSTOMER", label: "거래처", hint: "거래선 / 구분(B2B·B2C) / 주문단위(차량·박스)" },
];

/** datetime-local 입력값(서울 로컬) → "YYYY-MM-DDTHH:mm:00+09:00" */
function seoulLocalToIso(v: string): string {
  return v ? `${v}:00+09:00` : "";
}
/** 지금(서울) → datetime-local 기본값 */
function nowSeoulLocal(): string {
  const { y, m, d, hh, mm } = seoulParts(new Date());
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export default function UploadForm({ initialKind }: { initialKind: UploadKind }) {
  const [kind, setKind] = useState<UploadKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [asOf, setAsOf] = useState(nowSeoulLocal);
  const [defectApplied, setDefectApplied] = useState<"yes" | "no">("no");
  const [mode, setMode] = useState<StockMode>("REPLACE");
  // (출고·생산실적) 이 파일의 집계 완료 월: 파일을 고르면 자동 제안, 담당자가 바꿀 수 있다
  const [completeMonth, setCompleteMonth] = useState("");
  const [suggestInfo, setSuggestInfo] = useState<{ lastDate: string; suggestion: string } | { error: string } | null>(null);
  const [preview, setPreview] = useState<StockPreview | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [lastFileName, setLastFileName] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const tab = TABS.find((t) => t.kind === kind)!;

  function reset() {
    setFile(null);
    setPreview(null);
    setCompleteMonth("");
    setSuggestInfo(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onFile(f: File | null) {
    setFile(f);
    setResult(null);
    setPreview(null);
    setSuggestInfo(null);
    setCompleteMonth("");
    if (f && kind === "STOCK") {
      const fd = new FormData();
      fd.set("file", f);
      startTransition(async () => setPreview(await previewStockAction(fd)));
    }
    if (f && (kind === "SALES" || kind === "PRODUCTION")) {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("kind", kind);
      startTransition(async () => {
        const r = await suggestCompletionAction(fd);
        if (r.ok) {
          setSuggestInfo({ lastDate: r.lastDate, suggestion: r.suggestion });
          setCompleteMonth(r.suggestion);
        } else setSuggestInfo({ error: r.message });
      });
    }
  }

  function send(allowRowErrors: boolean) {
    if (!file) return;
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    if (kind === "STOCK") {
      fd.set("stockAsOf", seoulLocalToIso(asOf));
      fd.set("defectApplied", defectApplied);
      fd.set("mode", mode);
    }
    if ((kind === "SALES" || kind === "PRODUCTION") && completeMonth) fd.set("completeThrough", completeMonth);
    if (allowRowErrors) fd.set("allowRowErrors", "1");
    setLastFileName(file.name);
    setResult(null);
    startTransition(async () => {
      const res = await uploadAction(fd);
      setResult(res);
      if (res.status === "saved") {
        setFile(null);
        setPreview(null);
        if (inputRef.current) inputRef.current.value = "";
        setAsOf(nowSeoulLocal());
        router.refresh(); // 서버 렌더된 "최근 업로드" 목록·기준 시각 갱신
      }
    });
  }

  const previewOk = preview?.status === "ok" ? preview : null;
  const canSaveStock = kind !== "STOCK" || previewOk !== null;

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
              reset();
            }}
            className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${
              kind === t.kind ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          // 재고: 미리보기에 오류 행이 있으면 "확인하고 진행"과 같은 의미로 allowRowErrors
          send(kind === "STOCK" && (previewOk?.errorCount ?? 0) > 0);
        }}
        className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4"
      >
        <p className="text-sm text-zinc-600">{tab.hint}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx,.csv,.txt"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />

        {(kind === "SALES" || kind === "PRODUCTION") && file && (
          <CompletionField info={suggestInfo} value={completeMonth} onChange={setCompleteMonth} pending={pending && !suggestInfo} kind={kind} />
        )}

        {kind === "STOCK" && file && (
          <PreviewCard preview={preview} pending={pending && !preview} mode={mode} onMode={setMode} />
        )}

        {kind === "STOCK" && (
          <div className="flex flex-col gap-3 rounded-md bg-zinc-50 p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-700">이 파일의 집계 기준 시각</span>
              <input
                type="datetime-local"
                value={asOf}
                max={nowSeoulLocal()}
                onChange={(e) => setAsOf(e.target.value)}
                className="h-11 rounded-md border border-zinc-300 bg-white px-3 text-base"
              />
              <span className="text-xs text-zinc-500">
                ERP에서 재고를 조회한 시각. 기본값은 지금. 비우면 &ldquo;집계 시각 미확인&rdquo;으로 표시됩니다. 이 시각 이전에 입력한
                출고·수주는 파일이 이미 반영한 것으로 보고 차감을 해제합니다.
              </span>
            </label>
            <fieldset className="flex flex-col gap-1 text-sm">
              <legend className="text-zinc-700">이 파일에 사후 불량이 반영되어 있나요?</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(
                  [
                    ["no", "아니오 — 불량 차감 유지"],
                    ["yes", "예 — 이전 불량 차감 리셋"],
                  ] as const
                ).map(([v, label]) => (
                  <label
                    key={v}
                    className={`flex h-11 cursor-pointer items-center justify-center rounded-md border px-2 text-center text-sm ${
                      defectApplied === v ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 bg-white text-zinc-700"
                    }`}
                  >
                    <input
                      type="radio"
                      name="defectApplied"
                      value={v}
                      checked={defectApplied === v}
                      onChange={() => setDefectApplied(v)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <button
          type="submit"
          disabled={!file || pending || !canSaveStock}
          className="h-12 rounded-md bg-blue-600 text-base font-semibold text-white disabled:bg-zinc-300"
        >
          {pending ? "처리 중…" : kind === "STOCK" ? (mode === "MERGE" ? "일부 갱신으로 저장" : "전체 교체로 저장") : `${tab.label} 업로드`}
        </button>
      </form>

      {result && <ResultCard r={result} kind={kind} fileName={lastFileName} onProceed={() => send(true)} pending={pending} />}
    </div>
  );
}

// ───────────────────────── 재고 미리보기 ─────────────────────────

function PreviewCard({
  preview,
  pending,
  mode,
  onMode,
}: {
  preview: StockPreview | null;
  pending: boolean;
  mode: StockMode;
  onMode: (m: StockMode) => void;
}) {
  if (pending || !preview) return <p className="text-sm text-zinc-500">파일을 읽는 중…</p>;
  if (preview.status === "mapping-error") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        <p className="font-semibold">컬럼이 맞지 않습니다. 저장할 수 없습니다.</p>
        <p className="mt-1">찾지 못한 필수 컬럼: {preview.missing.join(" / ")}</p>
        <p className="mt-1 break-all font-mono text-xs">{preview.headerFound.join(" | ")}</p>
      </div>
    );
  }
  if (preview.status === "error") {
    return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{preview.message}</p>;
  }
  const p = preview;
  const ec = errorCounts(p.errors);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
      {p.duplicate && (
        <p data-testid="preview-same-file" className="font-semibold text-amber-800">
          같은 파일을 이미 반영했습니다 ({formatDateTime(p.duplicate.uploadedAt)} · 집계 {p.duplicate.stockAsOf ? formatDateTime(p.duplicate.stockAsOf) : "시각 미확인"} · 사후 불량{" "}
          {p.duplicate.defectApplied ? "반영됨" : "미반영"}). 같은 집계 시각·불량 선택이면 다시 저장되지 않고, 바꾸면 새 기준으로 반영됩니다.
        </p>
      )}
      <p className="font-semibold">
        기존 대비 신규 {p.added.toLocaleString()} / 변경 {p.changed.toLocaleString()} / 누락 {p.missing.toLocaleString()} 품목
        <span className="ml-1 font-normal text-blue-900">(동일 {p.same.toLocaleString()} · 파일 정상 {p.fileProducts.toLocaleString()})</span>
      </p>
      {p.duplicateCodes > 0 && (
        <p data-testid="dup-codes" className="font-semibold text-orange-800">
          중복 품번 {p.duplicateCodes.toLocaleString()}개 — 같은 품번이 두 줄 이상이라 합산하지 않고 &ldquo;확인 필요&rdquo;로 둡니다.
        </p>
      )}
      <p className="text-xs text-blue-900">
        {p.previousBatch
          ? `기존 기준: ${p.previousBatch.fileName} · ${formatDateTime(p.previousBatch.uploadedAt)} · ${p.previousBatch.products.toLocaleString()}품목`
          : "기존 기준재고 없음 — 첫 업로드"}
      </p>
      {p.errorCount > 0 && (
        <p className="text-red-800">
          오류 {p.errorCount.toLocaleString()}행 — 품번 불일치 {ec.code.toLocaleString()} · 수량 누락 {ec.qty.toLocaleString()}
          {ec.other > 0 && ` · 기타 ${ec.other.toLocaleString()}`}. 저장하면 이 행들은 제외되고 해당 품목은 &ldquo;확인 필요&rdquo;가 됩니다.
        </p>
      )}
      <ErrorDetails errors={p.errors} title={`문제 행 ${p.errorCount.toLocaleString()}건 펼쳐보기`} />
      {p.changedSample.length > 0 && (
        <details>
          <summary className="cursor-pointer">변경 품목 예시 ({Math.min(10, p.changed)}건)</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {p.changedSample.map((c) => (
              <li key={c.code}>
                {c.name} ({c.code}): {c.before.toLocaleString()} → {c.after.toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
      {p.missing > 0 && (
        <details>
          <summary className="cursor-pointer">누락 품목 예시 ({Math.min(10, p.missing)}건)</summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {p.missingSample.map((m) => (
              <li key={m.code}>
                {m.name} ({m.code}): 기존 {m.qtyBox.toLocaleString()}
              </li>
            ))}
          </ul>
        </details>
      )}
      <fieldset className="mt-1">
        <legend className="text-xs text-blue-900">누락 품목 처리</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(
            [
              ["REPLACE", "전체 교체", "파일에 없는 품목은 '재고 확인 필요'"],
              ["MERGE", "일부 갱신", "파일에 없는 품목은 이전 수량·집계 시각 유지"],
            ] as const
          ).map(([v, label, desc]) => (
            <label
              key={v}
              className={`flex cursor-pointer flex-col items-center rounded-md border px-2 py-2 text-center ${
                mode === v ? "border-blue-600 bg-blue-600 text-white" : "border-zinc-300 bg-white text-zinc-700"
              }`}
            >
              <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => onMode(v)} className="sr-only" />
              <span className="text-sm font-semibold">{label}</span>
              <span className={`text-xs ${mode === v ? "text-blue-100" : "text-zinc-500"}`}>{desc}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-blue-900">저장 뒤에도 아래 &ldquo;이전 기준재고로 복구&rdquo;로 되돌릴 수 있습니다.</p>
    </div>
  );
}

// ───────────────────────── 결과 ─────────────────────────

/** 업로드 종류별 한 줄 요약 — "재고 60개 품목 갱신, 반영 시각 04:35" */
function summarize(kind: UploadKind, r: Extract<UploadResponse, { status: "saved" }>): string {
  const x = r.result;
  const n = (v: number) => v.toLocaleString();
  const time = formatDateTime(r.uploadedAt).slice(11);
  switch (kind) {
    case "STOCK":
      return `${n(x.inserted)}개 품목 갱신됨${x.carried ? ` (+ 이월 ${n(x.carried)})` : ""} · 반영 ${time}`;
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

function NextAction({ kind, batchId }: { kind: UploadKind; batchId: string }) {
  const btn = "inline-flex h-12 items-center rounded-lg px-4 text-base font-semibold";
  return (
    <div className="flex flex-wrap gap-2">
      {(kind === "STOCK" || kind === "PRODUCT") && (
        <Link href="/" className={`${btn} bg-blue-600 text-white`}>
          재고 보기 →
        </Link>
      )}
      {(kind === "SALES" || kind === "PRODUCTION") && (
        <Link href="/analytics" className={`${btn} bg-blue-600 text-white`}>
          추이 보기 →
        </Link>
      )}
      <Link href={`/upload/${batchId}`} className={`${btn} border border-zinc-300 text-zinc-800 hover:bg-blue-50`}>
        업로드 상세
      </Link>
    </div>
  );
}

/** 오류 행을 종류별로 집계 — 품번 불일치 / 수량 누락·오류 / 기타 */
function errorCounts(errors: RowError[]) {
  let code = 0;
  let qty = 0;
  let other = 0;
  const dupCodes = new Set<string>();
  for (const e of errors) {
    if (e.kind === "CODE") code++;
    else if (e.kind === "QTY") qty++;
    else if (e.kind === "DUP") dupCodes.add(e.code ?? String(e.row));
    else other++;
  }
  return { code, qty, other, dup: dupCodes.size };
}

function ErrorDetails({ errors, title }: { errors: RowError[]; title: string }) {
  if (errors.length === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer font-medium text-red-700">{title}</summary>
      <ul className="mt-1 max-h-60 list-disc overflow-y-auto pl-5 text-red-800">
        {errors.slice(0, 200).map((e) => (
          <li key={e.row}>
            {e.row}행: {e.message}
          </li>
        ))}
        {errors.length > 200 && <li>… 외 {(errors.length - 200).toLocaleString()}건</li>}
      </ul>
    </details>
  );
}

function SampleNote({ fileName }: { fileName: string }) {
  if (!isSampleFileName(fileName)) return null;
  return <span className="ml-2 inline-block rounded bg-purple-100 px-1.5 py-0.5 text-xs font-semibold text-purple-800">샘플</span>;
}

function ResultCard({
  r,
  kind,
  fileName,
  onProceed,
  pending,
}: {
  r: UploadResponse;
  kind: UploadKind;
  fileName: string;
  onProceed: () => void;
  pending: boolean;
}) {
  if (r.status === "saved") {
    const x = r.result;
    const ec = errorCounts(x.errors);
    return (
      <div data-testid="upload-saved" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
        <p className="text-base font-semibold text-green-800">
          {summarize(kind, r)}
          <SampleNote fileName={fileName} />
        </p>
        <ul className="mt-2 space-y-1 text-green-900">
          <li>
            반영 시각: {formatDateTime(r.uploadedAt)} · {(r.elapsedMs / 1000).toFixed(1)}초 · {r.format}
          </li>
          <li>
            정상 반영 {x.inserted.toLocaleString()} · 품번 불일치 {ec.code.toLocaleString()} · 수량 누락 {ec.qty.toLocaleString()}
            {ec.dup > 0 && ` · 중복 품번 ${ec.dup.toLocaleString()}개`}
            {ec.other > 0 && ` · 기타 오류 ${ec.other.toLocaleString()}`}
            {(x.carried ?? 0) > 0 && ` · 이월 ${x.carried!.toLocaleString()}`}
            {(x.duplicates ?? 0) > 0 && ` · 중복 건너뜀 ${x.duplicates!.toLocaleString()}`}
            {(x.updated ?? 0) > 0 && kind !== "STOCK" && ` · 갱신 ${x.updated!.toLocaleString()}`}
            {x.newProducts + x.newCustomers > 0 && ` · 신규 ${(x.newProducts + x.newCustomers).toLocaleString()}`}
          </li>
          {x.note && <li>{x.note}</li>}
        </ul>
        {x.warnings?.map((w) => (
          <p key={w} className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
            ⚠ {w}
          </p>
        ))}
        <ErrorDetails errors={x.errors} title={`문제 행 ${x.errors.length.toLocaleString()}건 펼쳐보기 (해당 품목은 "재고 확인 필요")`} />
        <div className="mt-3">
          <NextAction kind={kind} batchId={r.batchId} />
        </div>
      </div>
    );
  }
  if (r.status === "row-errors") {
    const ec = errorCounts(r.errors);
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="text-base font-semibold">
          {r.errorCount.toLocaleString()}행 오류. 아직 저장하지 않았습니다.
          <SampleNote fileName={fileName} />
        </p>
        <p className="mt-1">
          정상 {r.validRows.toLocaleString()} · 품번 불일치 {ec.code.toLocaleString()} · 수량 누락 {ec.qty.toLocaleString()}
          {ec.dup > 0 && ` · 중복 품번 ${ec.dup.toLocaleString()}개`}
          {ec.other > 0 && ` · 기타 ${ec.other.toLocaleString()}`}
        </p>
        <p className="mt-1">
          그대로 진행하면 해당 품목은 &ldquo;재고 확인 필요&rdquo;가 됩니다. 정상 행만 저장됩니다. 엑셀을 고쳐 다시 올리는 쪽을 권합니다.
        </p>
        <ErrorDetails errors={r.errors} title={`문제 행 ${r.errorCount.toLocaleString()}건 펼쳐보기`} />
        <button
          type="button"
          onClick={onProceed}
          disabled={pending}
          className="mt-3 h-11 rounded-md border border-amber-700 bg-white px-4 text-sm font-semibold text-amber-900 disabled:opacity-50"
        >
          {pending ? "저장 중…" : "오류 행을 제외하고 그대로 진행"}
        </button>
      </div>
    );
  }
  if (r.status === "duplicate") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">같은 파일을 같은 설정으로 이미 반영했습니다. 다시 저장하지 않았습니다.</p>
        <p className="mt-1">
          {r.fileName} · {formatDateTime(r.uploadedAt)}
        </p>
      </div>
    );
  }
  if (r.status === "mapping-error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">컬럼이 맞지 않아 저장하지 않았습니다. 직전 재고 기준이 그대로 유지됩니다.</p>
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
      <p className="font-semibold">업로드 실패. 직전 재고 기준이 그대로 유지됩니다.</p>
      <p className="mt-1 break-all">{r.message}</p>
    </div>
  );
}

/** 출고·생산실적: 이 파일의 집계 완료 월 (기본 제안 + 수정) */
function CompletionField({
  info,
  value,
  onChange,
  pending,
  kind,
}: {
  info: { lastDate: string; suggestion: string } | { error: string } | null;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  kind: "SALES" | "PRODUCTION";
}) {
  if (pending || !info) return <p className="text-sm text-zinc-500">파일의 마지막 날짜를 읽는 중…</p>;
  if ("error" in info) return <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{info.error}</p>;
  const lastYm = info.lastDate.slice(0, 7);
  const pendingMonth = value && value < lastYm;
  return (
    <div className="flex flex-col gap-1 rounded-md bg-zinc-50 p-3 text-sm" data-testid="completion-field">
      <label htmlFor="complete-month" className="text-zinc-700">
        이 파일의 집계 완료 월
      </label>
      <input
        id="complete-month"
        type="month"
        value={value}
        max={lastYm}
        onChange={(e) => onChange(e.target.value)}
        className="num h-11 rounded-md border border-zinc-300 bg-white px-3 text-base"
      />
      <p className="num text-xs text-zinc-600">
        파일 마지막 {kind === "SALES" ? "출고일" : "생산일"} <b>{info.lastDate}</b> → 기본 제안 <b>{info.suggestion}</b>
        {info.suggestion < lastYm ? ` (${lastYm}은 말일·마지막 영업일 전에 끝나 집계 중으로 봄)` : " (그 달 말일·마지막 영업일까지 자료 있음)"}
      </p>
      <p className="text-xs text-zinc-500">
        {pendingMonth
          ? `${value} 이후 달은 분석 비교에서 "집계 중"으로 빠집니다. 그 달 자료가 다 들어왔다면 ${lastYm}으로 바꾸세요.`
          : "분석 화면의 전년 동기간·최근 12개월 비교는 이 달까지만 씁니다."}{" "}
        저장 후에도 업로드 상세에서 고칠 수 있습니다.
      </p>
    </div>
  );
}
