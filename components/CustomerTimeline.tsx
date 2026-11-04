"use client";

/**
 * 거래선의 주력 제품별 월별 출고 + 탐지 결과 점. 점(또는 아래 목록)을 누르면 탐지 설명과 메모가 바로 아래 펼쳐진다.
 * 점 위치: 거래처×품목 변화는 그 품목 선 위, 거래처 단위 변화는 '거래선 합계' 선 위, 변화가 시작된 달.
 * 별도 증감 규칙(±50% 등)을 만들지 않고 탐지 결과를 그대로 쓴다. 원인은 단정하지 않는다.
 */
import type { Timeline } from "@/lib/analytics/customerTop";
import type { EventView } from "@/lib/events/query";
import { useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, XAxis, YAxis } from "recharts";
import { EventDetailBody } from "./EventList";

const COLORS = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#0891b2"];
const TOTAL = "#71717a";
const nf = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}백만` : v >= 10_000 ? `${Math.round(v / 10_000)}만` : v.toLocaleString("ko-KR"));

export default function CustomerTimeline({ data, events, canNote }: { data: Timeline; events: EventView[]; canNote: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(
    () =>
      data.months.map((m, i) => {
        const r: Record<string, number | string | null> = { ym: `${m.slice(2, 4)}.${m.slice(5, 7)}`, total: data.total[i] };
        for (const p of data.products) r[p.code] = data.series[p.code][i];
        return r;
      }),
    [data],
  );
  const idx = new Map(data.months.map((m, i) => [m, i]));
  const onLine = new Set(data.products.map((p) => p.code));
  const dots = events
    .map((e) => {
      const i = idx.get(e.periodStart.slice(0, 7));
      if (i === undefined) return null;
      const lineKey = e.scope === "PAIR" && e.product && onLine.has(e.product) ? e.product : "total";
      const y = lineKey === "total" ? data.total[i] : data.series[lineKey][i];
      return { id: e.id, ym: rows[i].ym as string, y, lineKey, e };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  const selected = events.find((e) => e.id === sel) ?? null;
  const yearMarks = data.months.filter((m) => m.endsWith("-01"));

  return (
    <div className="flex flex-col gap-2" data-testid="customer-timeline">
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e4e4e7" vertical={false} />
            <XAxis dataKey="ym" tick={{ fontSize: 10, fill: "#71717a" }} interval="preserveStartEnd" minTickGap={24} ticks={yearMarks.map((m) => `${m.slice(2, 4)}.01`)} />
            <YAxis tick={{ fontSize: 10, fill: "#71717a" }} width={52} tickFormatter={nf} label={{ value: "개", position: "insideTopLeft", offset: 0, dy: -6, fontSize: 10, fill: "#71717a" }} />
            <Legend verticalAlign="top" height={36} iconSize={10} wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="total" name="거래선 합계" stroke={TOTAL} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            {data.products.map((p, k) => (
              <Line key={p.code} dataKey={p.code} name={p.name.length > 14 ? `${p.name.slice(0, 14)}…` : p.name} stroke={COLORS[k]} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
            <Scatter
              data={dots.map((d) => ({ ym: d.ym, y: d.y, id: d.id }))}
              dataKey="y"
              name="탐지된 변화"
              fill="#111827"
              shape={(props: { cx?: number; cy?: number; payload?: { id: string } }) => (
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={props.payload?.id === sel ? 8 : 6}
                  fill={props.payload?.id === sel ? "#dc2626" : "#111827"}
                  stroke="#fff"
                  strokeWidth={2}
                  style={{ cursor: "pointer" }}
                  data-testid="event-dot"
                  onClick={() => setSel((cur) => (cur === props.payload?.id ? null : (props.payload?.id ?? null)))}
                />
              )}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-zinc-500">
        단위 개(낱개) · 기간 출고 상위 5개 제품 + 거래선 합계(점선) · 검은 점 = 탐지된 변화(누르면 설명). 제품마다 수량 크기가 달라 작은 제품은 아래 목록으로 확인하세요.
      </p>
      {selected && <EventDetailBody e={selected} canNote={canNote} />}
      <div data-testid="customer-events">
        <p className="text-sm font-semibold text-zinc-800">이 거래선에서 탐지된 변화 {events.length}건</p>
        {events.length === 0 ? (
          <p className="text-sm text-zinc-500">탐지된 변화가 없습니다.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {events.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  aria-pressed={sel === e.id}
                  onClick={() => setSel((cur) => (cur === e.id ? null : e.id))}
                  className={`w-full min-h-11 rounded-md border px-3 py-1.5 text-left text-sm ${sel === e.id ? "border-blue-500 bg-blue-50" : "border-zinc-200 hover:bg-blue-50"}`}
                  data-testid="customer-event"
                >
                  {e.title}
                  {!onLine.has(e.product ?? "") && e.scope === "PAIR" && <span className="ml-1 text-xs text-zinc-500">(그래프 밖 품목)</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
