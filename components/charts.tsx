"use client";

/**
 * Recharts 차트 모음. 색: 생산 파랑 #2563eb, 출고 주황 #ea580c (validate_palette 통과).
 * 단일 계열은 범례 없이 제목으로, 2계열은 범례 + 마지막 점 직접 라벨. 모든 차트에 단위(박스)와 기준 시각.
 * 마우스를 올리면 그 지점 수치 툴팁.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const COLOR_PRODUCTION = "#2563eb";
export const COLOR_SHIPMENT = "#ea580c";
const COLOR_MUTED_BAR = "#bfdbfe"; // blue-200 — 같은 색상의 옅은 단계 (강조와 구분)
const GRID = "#e4e4e7";
const AXIS = "#71717a";

const nf = (v: number) => v.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const tooltipStyle = { fontSize: 12, borderRadius: 6, border: "1px solid #e4e4e7", boxShadow: "none" };

/** 차트 머리말: 제목 · 단위 · 기준 */
export function ChartHead({ title, unit, basis }: { title: string; unit: string; basis?: string | null }) {
  return (
    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <span className="text-xs text-zinc-500">
        단위: {unit}
        {basis && ` · ${basis}`}
      </span>
    </div>
  );
}

/** 품목 상세: 최근 30일 일별 출고 미니 막대 */
export function Sparkline({ data }: { data: { date: string; qtyBox: number }[] }) {
  return (
    <div className="h-20 w-full" aria-label="최근 30일 일별 출고 막대그래프">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip
            cursor={{ fill: "#f4f4f5" }}
            contentStyle={tooltipStyle}
            labelFormatter={(l) => String(l).slice(5)}
            formatter={(v) => [`${nf(Number(v))} 박스`, "출고"]}
          />
          <Bar dataKey="qtyBox" fill={COLOR_SHIPMENT} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 월별 생산·출고 (선 2개, 한 축 = 박스) */
export function TrendChart({ data }: { data: { yearMonth: string; production: number; shipment: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="yearMonth" tick={{ fontSize: 11, fill: AXIS }} tickFormatter={(v: string) => v.slice(2)} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={48} tickFormatter={(v: number) => nf(v)} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [`${nf(Number(v))} 박스`, name === "production" ? "생산" : "출고"]} />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "production" ? "생산 (본가공+재가공입고)" : "출고 (정상·내수)")} />
          <Line type="monotone" dataKey="production" stroke={COLOR_PRODUCTION} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="shipment" stroke={COLOR_SHIPMENT} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 계절지수 1~12월 막대, 1.0 기준선, 1.2 이상 진하게 + "성수기" */
export function SeasonChart({ rows, peak = 1.2 }: { rows: { month: number; index: number | null; avg: number }[]; peak?: number }) {
  const data = rows.map((r) => ({ month: `${r.month}월`, index: r.index === null ? 0 : Math.round(r.index * 100) / 100, avg: r.avg, isPeak: (r.index ?? 0) >= peak }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: AXIS }} interval={0} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={32} domain={[0, (max: number) => Math.max(1.4, Math.ceil(max * 10) / 10)]} />
          <Tooltip
            cursor={{ fill: "#f4f4f5" }}
            contentStyle={tooltipStyle}
            formatter={(v, _n, item) => {
              const p = (item as { payload?: { avg: number } }).payload;
              return [`지수 ${Number(v).toFixed(2)} · 평균 출고 ${nf(p?.avg ?? 0)} 박스`, "계절지수"];
            }}
          />
          <ReferenceLine y={1} stroke={AXIS} strokeDasharray="4 4" label={{ value: "1.0 평균", position: "insideTopRight", fontSize: 10, fill: AXIS }} />
          <Bar dataKey="index" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.month} fill={d.isPeak ? COLOR_PRODUCTION : COLOR_MUTED_BAR} />
            ))}
            <LabelList dataKey="isPeak" position="top" content={PeakLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PeakLabel(props: { x?: number | string; y?: number | string; width?: number | string; value?: unknown }) {
  if (!props.value) return null;
  const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
  const y = Number(props.y ?? 0) - 4;
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={10} fontWeight={600} fill="#1e3a8a">
      성수기
    </text>
  );
}

/** 생산→출고 시차 상관 0~3개월, 최고 막대 강조 + 계수 */
export function LagChart({ rows, best }: { rows: { lag: number; r: number | null }[]; best: number | null }) {
  const data = rows.map((r) => ({ lag: `${r.lag}개월`, r: r.r === null ? 0 : Math.round(r.r * 100) / 100, isBest: r.lag === best, hasValue: r.r !== null }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap="25%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="lag" tick={{ fontSize: 11, fill: AXIS }} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={32} domain={[(min: number) => Math.min(0, Math.floor(min * 10) / 10), 1]} />
          <Tooltip cursor={{ fill: "#f4f4f5" }} contentStyle={tooltipStyle} formatter={(v) => [`r = ${Number(v).toFixed(2)}`, "상관계수"]} />
          <ReferenceLine y={0} stroke={AXIS} />
          <Bar dataKey="r" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.lag} fill={d.isBest ? COLOR_PRODUCTION : COLOR_MUTED_BAR} />
            ))}
            <LabelList dataKey="r" position="top" fontSize={11} fill="#18181b" formatter={(v) => Number(v).toFixed(2)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 전체 5년 월별 출고 (선 1개) */
export function TotalChart({ data }: { data: { yearMonth: string; shipment: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="yearMonth" tick={{ fontSize: 11, fill: AXIS }} tickFormatter={(v: string) => v.slice(2)} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={56} tickFormatter={(v: number) => nf(v)} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${nf(Number(v))} 박스`, "출고"]} />
          <Line type="monotone" dataKey="shipment" stroke={COLOR_SHIPMENT} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
