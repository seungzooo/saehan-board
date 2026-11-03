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
import { formatUnits } from "@/lib/analytics/periods";

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

/** 월별 생산·판매 (선 2개, 한 축). 입력은 낱개, boxSize가 있으면 박스로 그린다. 툴팁 = "2박스 50개" */
export function TrendChart({
  data,
  boxSize,
}: {
  data: { yearMonth: string; production: number; shipment: number }[];
  boxSize: number | null;
}) {
  const d = data.map((p) => ({ ...p, pv: boxSize ? p.production / boxSize : p.production, sv: boxSize ? p.shipment / boxSize : p.shipment }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={d} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="yearMonth" tick={{ fontSize: 11, fill: AXIS }} tickFormatter={(v: string) => v.slice(2)} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={52} tickFormatter={(v: number) => nf(v)} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(_v, name, item) => {
              const p = (item as { payload?: { production: number; shipment: number } }).payload;
              const units = name === "pv" ? (p?.production ?? 0) : (p?.shipment ?? 0);
              return [formatUnits(units, boxSize), name === "pv" ? "생산" : "판매(정상)"];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === "pv" ? "생산 (본가공+재가공입고)" : "판매 (정상 출고)")} />
          <Line type="monotone" dataKey="pv" stroke={COLOR_PRODUCTION} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="sv" stroke={COLOR_SHIPMENT} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
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

/** 생산월 t ↔ 출고월 t+k 시차 상관 (k = 0..6), 최고 막대 강조 + 계수. 툴팁에 유효 월 쌍 수 */
export function LagChart({ rows, best }: { rows: { lag: number; r: number | null; n: number }[]; best: number | null }) {
  const data = rows.map((r) => ({ lag: `+${r.lag}`, r: r.r === null ? 0 : Math.round(r.r * 100) / 100, n: r.n, isBest: r.lag === best, hasValue: r.r !== null }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="lag" tick={{ fontSize: 11, fill: AXIS }} label={{ value: "k (개월 뒤 출고)", position: "insideBottomRight", offset: -2, fontSize: 10, fill: AXIS }} />
          <YAxis tick={{ fontSize: 11, fill: AXIS }} width={32} domain={[(min: number) => Math.min(0, Math.floor(min * 10) / 10), 1]} />
          <Tooltip
            cursor={{ fill: "#f4f4f5" }}
            contentStyle={tooltipStyle}
            labelFormatter={(l) => `생산월 t ↔ 출고월 t${String(l)}`}
            formatter={(v, _n, item) => {
              const p = (item as { payload?: { n: number; hasValue: boolean } }).payload;
              return [p?.hasValue ? `r = ${Number(v).toFixed(2)} · 유효 ${p.n}쌍` : `산정 불가 · 유효 ${p?.n ?? 0}쌍`, "상관계수"];
            }}
          />
          <ReferenceLine y={0} stroke={AXIS} />
          <Bar dataKey="r" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.lag} fill={d.isBest ? COLOR_PRODUCTION : COLOR_MUTED_BAR} />
            ))}
            <LabelList dataKey="r" position="top" fontSize={10} fill="#18181b" formatter={(v) => Number(v).toFixed(2)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 월별 반품 (정상 판매와 따로) — 단일 계열, 회색. 입력은 낱개 */
export function ReturnsChart({ data, boxSize }: { data: { yearMonth: string; returns: number }[]; boxSize: number | null }) {
  const d = data.map((p) => ({ ...p, v: boxSize ? p.returns / boxSize : p.returns }));
  return (
    <div className="h-24 w-full" aria-label="월별 반품 막대그래프">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={d} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis dataKey="yearMonth" tick={{ fontSize: 10, fill: AXIS }} tickFormatter={(v: string) => v.slice(2)} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={{ fontSize: 10, fill: AXIS }} width={48} tickFormatter={(v: number) => nf(v)} />
          <Tooltip
            cursor={{ fill: "#f4f4f5" }}
            contentStyle={tooltipStyle}
            formatter={(_v, _n, item) => [formatUnits((item as { payload?: { returns: number } }).payload?.returns ?? 0, boxSize), "반품"]}
          />
          <Bar dataKey="v" fill="#71717a" radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 월별 출고량 한 점 (낱개). units null = 자료 없음·집계 중 → 선을 끊는다 */
export type MonthPointView = { month: number; ym: string; units: number | null; status: "ok" | "missing" | "incomplete" | "nodata" };

const STATUS_TEXT = { missing: "자료 누락", incomplete: "집계 중", nodata: "자료 없음", ok: "" } as const;

function MonthTooltip({
  active,
  payload,
  boxSize,
}: {
  active?: boolean;
  payload?: { payload: MonthPointView }[];
  boxSize: number | null;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const [y, m] = p.ym.split("-");
  return (
    <div style={tooltipStyle} className="bg-white px-2 py-1" data-testid="month-tooltip">
      <p className="font-semibold">
        {y}년 {Number(m)}월
      </p>
      <p className="num">{p.units === null ? STATUS_TEXT[p.status] : `정상 출고 ${formatUnits(p.units, boxSize)}`}</p>
    </div>
  );
}

/** 선택 연도 월별 출고량 — 가로축 1~12월 고정, 자료 없는 달은 선을 끊는다, 완료된 0은 0 */
export function YearMonthChart({ points, boxSize, unit }: { points: MonthPointView[]; boxSize: number | null; unit: string }) {
  const data = points.map((p) => ({ ...p, label: `${p.month}월`, v: p.units === null ? null : boxSize ? p.units / boxSize : p.units }));
  return (
    <div className="h-60 w-full" data-testid="year-month-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" interval={0} tick={{ fontSize: 10, fill: AXIS }} tickMargin={4} />
          <YAxis
            tick={{ fontSize: 10, fill: AXIS }}
            width={56}
            tickFormatter={(v: number) => (v >= 1_000_000 ? `${nf(v / 1_000_000)}백만` : v >= 10_000 ? `${nf(v / 10_000)}만` : nf(v))}
            label={{ value: unit, position: "insideTopLeft", offset: 0, dy: -6, fontSize: 10, fill: AXIS }}
          />
          <Tooltip content={<MonthTooltip boxSize={boxSize} />} cursor={{ stroke: "#a1a1aa" }} />
          <Line
            type="linear"
            dataKey="v"
            stroke={COLOR_SHIPMENT}
            strokeWidth={2}
            connectNulls={false}
            dot={{ r: 3, fill: COLOR_SHIPMENT }}
            activeDot={{ r: 6 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 전체 기간 월별 출고량 — 해가 바뀌는 1월마다 세로 구분선과 연도 라벨 */
export function AllPeriodChart({ points, boxSize, unit }: { points: MonthPointView[]; boxSize: number | null; unit: string }) {
  const data = points.map((p) => ({ ...p, v: p.units === null ? null : boxSize ? p.units / boxSize : p.units }));
  const yearStarts = points.filter((p) => p.month === 1).map((p) => p.ym);
  return (
    <div className="h-60 w-full" data-testid="all-period-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="ym" tick={false} height={8} />
          <YAxis
            tick={{ fontSize: 10, fill: AXIS }}
            width={56}
            tickFormatter={(v: number) => (v >= 1_000_000 ? `${nf(v / 1_000_000)}백만` : v >= 10_000 ? `${nf(v / 10_000)}만` : nf(v))}
            label={{ value: unit, position: "insideTopLeft", offset: 0, dy: -16, fontSize: 10, fill: AXIS }}
          />
          {yearStarts.map((ym) => (
            <ReferenceLine
              key={ym}
              x={ym}
              stroke="#a1a1aa"
              strokeDasharray="3 3"
              label={{ value: `${ym.slice(0, 4)}년`, position: "top", fontSize: 10, fill: "#52525b" }}
            />
          ))}
          <Tooltip content={<MonthTooltip boxSize={boxSize} />} cursor={{ stroke: "#a1a1aa" }} />
          <Line type="linear" dataKey="v" stroke={COLOR_SHIPMENT} strokeWidth={2} connectNulls={false} dot={false} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
