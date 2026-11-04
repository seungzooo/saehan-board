"use client";

/**
 * 분석 화면 공용 차트 — 마우스를 올려야만 보이는 툴팁을 쓰지 않는다.
 * - 막대·점(가로축 한 칸)을 클릭·터치하거나, 차트에 포커스를 두고 ←/→ 키로 고르면 차트 바로 아래에 상세 설명 하나만 펼친다.
 * - 차트 아래 "표로 보기"에 같은 값을 표로 보여 주고, 표의 행을 눌러도(Enter·Space 포함) 같은 항목이 선택된다.
 * 모든 값·문장은 서버(또는 부모)가 미리 만들어 넘긴다 — 직렬화 가능한 props만 받는다.
 */
import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

export type PickSeries = { name: string; color: string; kind: "bar" | "line" };
export type PickPoint = {
  /** 가로축 라벨 */
  label: string;
  /** series 순서대로 값. null = 자료 없음(막대·점 없음, 선 끊김) */
  values: (number | null)[];
  /** 선택했을 때 펼칠 설명: 제목 한 줄 + 문장들 */
  detail: { title: string; lines: string[] };
  /** 강조할 막대 (최고값 등) */
  highlight?: boolean;
};
export type PickTable = { headers: string[]; rows: string[][] };

const GRID = "#e4e4e7";
const Y_AXIS_WIDTH = 52;
const RIGHT_MARGIN = 12;
const AXIS = "#71717a";
const nf = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });

export function formatTick(v: number, format: "num" | "pct" | "r" | "index"): string {
  if (format === "pct") return `${v > 0 ? "+" : ""}${nf(v)}%`;
  if (format === "r" || format === "index") return v.toFixed(format === "r" ? 1 : 1);
  return Math.abs(v) >= 1_000_000 ? `${nf(v / 1_000_000)}백만` : Math.abs(v) >= 10_000 ? `${nf(v / 10_000)}만` : nf(v);
}

export default function PickChart({
  testid,
  points,
  series,
  yUnit,
  yFormat = "num",
  table,
  initialSelected = null,
  yearMarks = [],
  hideXTicks = false,
  height = 240,
  zeroLine = false,
  yDomain,
}: {
  testid: string;
  points: PickPoint[];
  series: PickSeries[];
  yUnit: string;
  yFormat?: "num" | "pct" | "r" | "index";
  table: PickTable;
  initialSelected?: number | null;
  /** 세로 구분선 (예: 해가 바뀌는 1월): 점 인덱스와 라벨 */
  yearMarks?: { index: number; label: string }[];
  hideXTicks?: boolean;
  height?: number;
  zeroLine?: boolean;
  yDomain?: [number | "auto", number | "auto"];
}) {
  const [sel, setSel] = useState<number | null>(initialSelected);
  const data = points.map((p, i) => {
    const row: Record<string, unknown> = { i, label: p.label };
    series.forEach((_, k) => (row[`s${k}`] = p.values[k]));
    return row;
  });
  const pick = (i: number | null | undefined) => {
    if (i === null || i === undefined || i < 0 || i >= points.length) return;
    setSel((cur) => (cur === i ? null : i));
  };
  const move = (d: number) => setSel((cur) => Math.max(0, Math.min(points.length - 1, (cur ?? (d > 0 ? -1 : points.length)) + d)));
  const detail = sel === null ? null : points[sel]?.detail;
  const showLegend = series.length > 1;

  return (
    <div data-testid={testid} data-kind={series[0]?.kind} className="flex flex-col gap-2">
      <div
        className="w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        style={{ height }}
        tabIndex={0}
        role="group"
        aria-label={`${table.headers[0]}별 차트 — ←/→ 키로 고르면 아래에 설명`}
        data-testid={`${testid}-plot`}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            move(-1);
          } else if (e.key === "Escape") setSel(null);
        }}
        onClick={(e) => {
          // 가로축 한 칸(band) 위치로 직접 계산 — 터치 탭은 마우스 이동 없이 오므로 차트 라이브러리의 활성 항목에 기대지 않는다
          const r = e.currentTarget.getBoundingClientRect();
          const left = r.left + Y_AXIS_WIDTH;
          const width = r.width - Y_AXIS_WIDTH - RIGHT_MARGIN;
          const x = e.clientX - left;
          if (x < 0 || x > width || points.length === 0) return;
          pick(Math.min(points.length - 1, Math.floor((x / width) * points.length)));
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: yearMarks.length ? 24 : 8, right: RIGHT_MARGIN, bottom: 0, left: 0 }}
            style={{ cursor: "pointer" }}
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="label"
              interval={hideXTicks ? "preserveStartEnd" : 0}
              tick={hideXTicks ? false : { fontSize: 10, fill: AXIS }}
              height={hideXTicks ? 8 : 30}
              tickMargin={4}
            />
            <YAxis
              tick={{ fontSize: 10, fill: AXIS }}
              width={Y_AXIS_WIDTH}
              domain={yDomain}
              tickFormatter={(v: number) => formatTick(v, yFormat)}
              label={{ value: yUnit, position: "insideTopLeft", offset: 0, dy: yearMarks.length ? -22 : -6, fontSize: 10, fill: AXIS }}
            />
            {zeroLine && <ReferenceLine y={0} stroke="#a1a1aa" />}
            {yearMarks.map((m) => (
              <ReferenceLine
                key={m.index}
                x={points[m.index]?.label}
                stroke="#a1a1aa"
                strokeDasharray="3 3"
                label={{ value: m.label, position: "insideTopLeft", dy: -20, dx: 2, fontSize: 10, fill: "#52525b" }}
              />
            ))}
            {sel !== null && <ReferenceLine x={points[sel]?.label} stroke="#1d4ed8" strokeOpacity={0.25} strokeWidth={18} />}
            {showLegend && <Legend verticalAlign="top" height={20} iconSize={10} wrapperStyle={{ fontSize: 11 }} />}
            {series.map((s, k) =>
              s.kind === "bar" ? (
                <Bar key={k} dataKey={`s${k}`} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                  {points.map((p, i) => (
                    <Cell key={i} fill={s.color} fillOpacity={sel === null || sel === i ? (p.highlight || series.length > 1 ? 1 : 0.85) : 0.35} />
                  ))}
                </Bar>
              ) : (
                <Line
                  key={k}
                  type="linear"
                  dataKey={`s${k}`}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  connectNulls={false}
                  dot={points.length <= 24 ? { r: 3, fill: s.color } : false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
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
        <p className="text-xs text-zinc-500">막대·점을 누르거나 표의 행을 고르면 여기에 설명이 나옵니다.</p>
      )}

      <DataTable testid={testid} table={table} selected={sel} onPick={pick} />
    </div>
  );
}

/** 차트와 같은 값의 표. 행을 누르거나 Enter·Space로 선택 */
export function DataTable({ testid, table, selected, onPick }: { testid: string; table: PickTable; selected: number | null; onPick: (i: number) => void }) {
  return (
    <details className="rounded-md border border-zinc-200 text-sm" data-testid={`${testid}-table`}>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-zinc-700">표로 보기</summary>
      <div className="overflow-x-auto">
        <table className="num w-full text-xs">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              {table.headers.map((h) => (
                <th key={h} className="px-2 py-1.5 text-left font-medium first:pl-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {table.rows.map((r, i) => (
              <tr
                key={i}
                tabIndex={0}
                role="button"
                aria-pressed={selected === i}
                onClick={() => onPick(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(i);
                  }
                }}
                className={`cursor-pointer outline-none hover:bg-blue-50 focus-visible:bg-blue-50 ${selected === i ? "bg-blue-100" : ""}`}
              >
                {r.map((c, k) => (
                  <td key={k} className="px-2 py-1.5 first:pl-3">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
