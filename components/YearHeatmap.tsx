import type { YearRow } from "@/lib/analytics/seasonal";

/**
 * 연도별 계절지수 히트맵 (연 × 월). 지수 = 해당 월 정상 출고 ÷ 해당 연도 월평균 정상 출고, 기준 1.
 * 발산형 색: 1 미만 주황 · 1 근처 회색 · 1 초과 파랑 (validate_palette 통과 쌍). 숫자를 칸에 직접 적어 색만으로 읽지 않게 한다.
 * - 실제 출고 0: 지수 0.0 (가장 진한 주황)
 * - 자료 없음(자료 범위 밖): 빗금 + "—"
 * - 연 출고 0(월평균 0): 회색 "0" — 지수 산정 불가
 */
const LOW = [234, 88, 12]; // #ea580c
const HIGH = [37, 99, 235]; // #2563eb
const MID = [244, 244, 245]; // #f4f4f5

function mix(a: number[], b: number[], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}

/** 지수 → 배경색. 0..1 → 주황..회색, 1..2+ → 회색..파랑 */
export function heatColor(index: number): { bg: string; dark: boolean } {
  if (index < 1) {
    const t = Math.max(0, index); // 0 → 주황, 1 → 회색
    return { bg: mix(LOW, MID, t), dark: t < 0.45 };
  }
  const t = Math.min(1, index - 1); // 1 → 회색, 2 이상 → 파랑
  return { bg: mix(MID, HIGH, t), dark: t > 0.55 };
}

const HATCH = "repeating-linear-gradient(135deg, #ffffff 0 4px, #e4e4e7 4px 5px)";

export default function YearHeatmap({ rows, unit = "박스" }: { rows: YearRow[]; unit?: string }) {
  if (rows.length === 0) return <p className="text-sm text-zinc-500">표시할 연도가 없습니다.</p>;
  return (
    <div>
      <div className="grid grid-cols-[2.6rem_repeat(12,minmax(0,1fr))] gap-px text-center text-[10px] leading-none" role="table" aria-label="연도별 월 계절지수">
        <div role="columnheader" />
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} role="columnheader" className="py-1 text-zinc-500">
            {i + 1}
          </div>
        ))}
        {rows.map((r) => (
          <YearLine key={r.year} r={r} unit={unit} />
        ))}
      </div>
      {/* 범례 */}
      <div className="num mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-16 rounded-sm" style={{ background: `linear-gradient(90deg, ${mix(LOW, MID, 0)}, ${mix(LOW, MID, 1)} 50%, ${mix(MID, HIGH, 1)})` }} />
          0 · 1(평균) · 2 이상
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm border border-zinc-200" style={{ background: HATCH }} />
          자료 없음
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-4 rounded-sm bg-zinc-300" />연 출고 0 (산정 불가)
        </span>
      </div>
    </div>
  );
}

function YearLine({ r, unit }: { r: YearRow; unit: string }) {
  return (
    <>
      <div role="rowheader" className="flex flex-col items-start justify-center pr-1 text-left text-[11px] text-zinc-700">
        <span className="font-semibold">{r.year}</span>
        {r.status === "ok" && r.covered < 12 && <span className="text-[9px] text-zinc-500">{r.covered}개월</span>}
      </div>
      {r.cells.map((c) => {
        const label = `${r.year}-${String(c.month).padStart(2, "0")}`;
        if (c.value === null) {
          return (
            <div key={c.month} role="cell" title={`${label} 자료 없음`} className="flex h-7 items-center justify-center text-zinc-400" style={{ background: HATCH }}>
              —
            </div>
          );
        }
        if (r.status === "zero" || c.index === null) {
          return (
            <div key={c.month} role="cell" title={`${label} 출고 0 · 연 출고 0이라 지수 산정 불가`} className="flex h-7 items-center justify-center bg-zinc-300 text-zinc-700">
              0
            </div>
          );
        }
        const { bg, dark } = heatColor(c.index);
        return (
          <div
            key={c.month}
            role="cell"
            title={`${label} 지수 ${c.index.toFixed(2)} · 정상 출고 ${Math.round(c.value).toLocaleString()}${unit} (연 월평균 ${Math.round(r.mean ?? 0).toLocaleString()})`}
            className={`num flex h-7 items-center justify-center ${dark ? "text-white" : "text-zinc-900"}`}
            style={{ background: bg }}
          >
            {c.index.toFixed(1)}
          </div>
        );
      })}
    </>
  );
}
