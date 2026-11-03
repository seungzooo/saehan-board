"use client";

/**
 * 어느 달에 평소보다 많이 출고됐나? — 연 × 월 히트맵. 셀 = 그해 월평균 대비 차이(반올림 전 지수로 계산, "+20%").
 * 발산형 색: 평균보다 적음 주황 · 평균 근처 회색 · 많음 파랑 (validate_palette 통과 쌍). 글자를 칸에 직접 적어 색만으로 읽지 않게 한다.
 * - 실제 출고 0: "없음" (가장 진한 주황)  - 자료 없음(범위 밖·집계 중): 빗금 "—"  - 그해 출고 0(기준값 0): 회색 "×"
 * 셀을 누르거나(Enter·Space) 표의 행을 고르면 바로 아래에 실제 출고량·그해 월평균·차이를 개수와 문장으로 펼친다.
 */
import { DataTable } from "@/components/PickChart";
import { heatCell } from "@/lib/analytics/explain";
import type { YearRow } from "@/lib/analytics/seasonal";
import { useMemo, useState } from "react";

const LOW = [234, 88, 12]; // #ea580c
const HIGH = [37, 99, 235]; // #2563eb
const MID = [244, 244, 245]; // #f4f4f5

function mix(a: number[], b: number[], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

/** 지수 → 배경색. 0..1 → 주황..회색, 1..2+ → 회색..파랑 */
export function heatColor(index: number): { bg: string; dark: boolean } {
  if (index < 1) {
    const t = Math.max(0, index);
    return { bg: mix(LOW, MID, t), dark: t < 0.45 };
  }
  const t = Math.min(1, index - 1);
  return { bg: mix(MID, HIGH, t), dark: t > 0.55 };
}

const HATCH = "repeating-linear-gradient(135deg, #ffffff 0 4px, #e4e4e7 4px 5px)";

export default function YearHeatmap({ rows, unit = "박스", testid = "heatmap" }: { rows: YearRow[]; unit?: string; testid?: string }) {
  const cells = useMemo(
    () => rows.flatMap((r) => r.cells.map((c) => ({ year: r.year, month: c.month, ...heatCell(r.year, c.month, c.value, r.mean, r.status, unit) }))),
    [rows, unit],
  );
  const [sel, setSel] = useState<number | null>(null);
  if (rows.length === 0) return <p className="text-sm text-zinc-500">표시할 연도가 없습니다.</p>;
  const pick = (i: number) => setSel((cur) => (cur === i ? null : i));
  const detail = sel === null ? null : cells[sel];
  const table = {
    headers: ["연월", "실제 출고", "그해 월평균", "차이"],
    rows: cells.map((c) => {
      const r = rows.find((x) => x.year === c.year)!;
      const v = r.cells[c.month - 1].value;
      return [
        `${c.year}년 ${c.month}월`,
        v === null ? "자료 없음" : v === 0 ? "출고 없음" : `${Math.round(v).toLocaleString()}${unit}`,
        r.mean ? `${Math.round(r.mean).toLocaleString()}${unit}` : "0 (기준 없음)",
        c.kind === "ok" || c.kind === "zero" ? c.text.replace("없음", "−100%") : c.kind === "nodata" ? "—" : "산정 불가",
      ];
    }),
  };

  return (
    <div data-testid={testid} className="flex flex-col gap-2">
      <div className="grid grid-cols-[2.6rem_repeat(12,minmax(0,1fr))] gap-px text-center text-[10px] leading-none" role="group" aria-label="연도별 월 출고 — 그해 월평균 대비">
        <div />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="py-1 text-zinc-500">
            {i + 1}월
          </div>
        ))}
        {rows.map((r) => (
          <div key={r.year} className="contents">
            <div data-testid="heat-year" className="flex flex-col items-start justify-center pr-1 text-left text-[11px] text-zinc-700">
              <span className="font-semibold">{r.year}</span>
              {r.status === "ok" && r.covered < 12 && <span className="text-[9px] text-zinc-500">{r.covered}개월</span>}
            </div>
            {r.cells.map((c) => {
              const i = cells.findIndex((x) => x.year === r.year && x.month === c.month);
              const cell = cells[i];
              const style =
                cell.kind === "nodata"
                  ? { background: HATCH }
                  : cell.kind === "base0"
                    ? { background: "#d4d4d8" }
                    : { background: heatColor("index" in cell ? (cell.index as number) : 0).bg };
              const dark = (cell.kind === "ok" || cell.kind === "zero") && heatColor("index" in cell ? (cell.index as number) : 0).dark;
              return (
                <button
                  key={c.month}
                  type="button"
                  aria-pressed={sel === i}
                  aria-label={`${cell.title} ${cell.lines[0]}`}
                  data-testid="heat-cell"
                  data-kind={cell.kind}
                  onClick={() => pick(i)}
                  className={`num flex h-8 items-center justify-center text-[9px] tracking-tighter outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:text-[11px] ${
                    sel === i ? "ring-2 ring-zinc-900" : ""
                  } ${cell.kind === "nodata" ? "text-zinc-400" : cell.kind === "base0" ? "text-zinc-700" : dark ? "text-white" : "text-zinc-900"}`}
                  style={style}
                >
                  {cell.text}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {/* 범례 */}
      <div className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-16 rounded-sm" style={{ background: `linear-gradient(90deg, ${mix(LOW, MID, 0)}, ${mix(LOW, MID, 1)} 50%, ${mix(MID, HIGH, 1)})` }} />
          적음 · 그해 월평균 · 많음
        </span>
        <span>없음 = 실제 출고 0</span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm border border-zinc-200" style={{ background: HATCH }} />— 자료 없음
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm bg-zinc-300" />× 그해 출고 0 (기준값 0)
        </span>
      </div>
      {detail ? (
        <div data-testid={`${testid}-detail`} role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          <p className="num font-semibold">{detail.title}</p>
          {detail.lines.map((l) => (
            <p key={l} className="num">
              {l}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-500">칸을 누르면 그 달의 실제 출고량·그해 월평균·차이가 여기에 나옵니다.</p>
      )}
      <DataTable testid={testid} table={table} selected={sel} onPick={pick} />
    </div>
  );
}
