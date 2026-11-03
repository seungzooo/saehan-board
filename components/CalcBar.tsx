import type { AvailableStock } from "@/lib/availableStock";

/**
 * 계산 근거를 막대 하나로: 기초재고 중 불량(빨강)·출고(회색)·수주(주황)·기타(연회색)가 빠지고 남은 현재 재고(파랑).
 * 조각 사이 2px 흰 틈, 숫자는 막대 아래 범례에 (색만으로 구분하지 않도록 글자·숫자 병기).
 */
const SEGMENTS = [
  { key: "DEFECT", label: "불량", color: "bg-red-600" },
  { key: "SHIPMENT", label: "출고", color: "bg-zinc-400" },
  { key: "ORDER", label: "수주", color: "bg-orange-500" },
  { key: "OTHER", label: "기타", color: "bg-zinc-300" },
] as const;

export default function CalcBar({ stock }: { stock: AvailableStock }) {
  if (stock.available === null || stock.baseline === null) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-400 p-3 text-sm text-zinc-600">
        최근 재고 파일에 이 품목이 없어 기초재고가 없습니다 — 확인 필요. 아래 변동 이력은 그대로 기록되어 있습니다.
      </p>
    );
  }
  const d = stock.deductions;
  const parts = SEGMENTS.map((s) => ({ ...s, value: Math.max(0, d[s.key]) }));
  const remaining = Math.max(0, stock.available);
  const scale = Math.max(stock.baseline, parts.reduce((a, p) => a + p.value, 0) + remaining, 1);
  const pct = (v: number) => `${(v / scale) * 100}%`;

  return (
    <div>
      <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded bg-zinc-100" role="img" aria-label={`기초재고 ${stock.baseline}박스에서 차감 후 현재 ${stock.available}박스`}>
        {parts.map((p) =>
          p.value > 0 ? <div key={p.key} className={`${p.color} h-full`} style={{ width: pct(p.value) }} title={`${p.label} ${p.value.toLocaleString()}박스`} /> : null,
        )}
        {remaining > 0 && <div className="h-full bg-blue-600" style={{ width: pct(remaining) }} title={`현재 재고 ${remaining.toLocaleString()}박스`} />}
      </div>
      <dl className="num mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div className="col-span-2 flex justify-between">
          <dt className="text-zinc-500">기초재고</dt>
          <dd className="font-semibold">{stock.baseline.toLocaleString()}</dd>
        </div>
        {parts.map((p) => (
          <div key={p.key} className="flex items-center justify-between">
            <dt className="flex items-center gap-1.5 text-zinc-600">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${p.color}`} aria-hidden="true" />
              {p.label}
            </dt>
            <dd>{d[p.key] === 0 ? "0" : `−${d[p.key].toLocaleString()}`}</dd>
          </div>
        ))}
        <div className="col-span-2 flex items-center justify-between border-t border-zinc-200 pt-1">
          <dt className="flex items-center gap-1.5 font-semibold text-zinc-900">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" aria-hidden="true" />
            현재 재고
          </dt>
          <dd className={`font-bold ${stock.available <= 0 ? "text-red-600" : "text-zinc-900"}`}>{stock.available.toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}
