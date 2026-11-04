import PickChart from "@/components/PickChart";
import { COLOR_PRODUCTION } from "@/components/charts";
import { lagLabel, lagView } from "@/lib/analytics/explain";

/** 생산·출고 시차 막대(같은 달 / 다음 달 / 2개월 뒤 …) + 계산 기준 */
export default function LagPick({ rows, best, criteria }: { rows: { lag: number; r: number | null; n: number }[]; best: number | null; criteria: string }) {
  const v = lagView(rows, best);
  return (
    <div className="flex flex-col gap-2">
      <PickChart
        testid="lag-chart"
        {...v}
        initialSelected={best}
        series={[{ name: "상관계수", color: COLOR_PRODUCTION, kind: "bar" }]}
        yUnit="상관계수"
        yFormat="r"
        yDomain={[-1, 1]}
        zeroLine
        height={200}
      />
      <details className="rounded-md border border-zinc-200 text-sm" data-testid="lag-criteria">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-zinc-700">계산 기준</summary>
        <div className="flex flex-col gap-1 px-3 pb-3 text-xs text-zinc-600">
          <p>{criteria}</p>
          <p>상관계수(−1~1): 1에 가까울수록 생산이 많은 달과 출고가 많은 달이 함께 나타남, 0 근처는 관계 없음, 음수는 반대로 움직임. 비교한 달 쌍이 3개 미만이거나 변동이 없으면 산정 불가.</p>
          <table className="num w-full max-w-md" data-testid="lag-table">
            <thead>
              <tr>
                <th className="py-1 text-left font-medium">시차</th>
                {rows.map((r) => (
                  <th key={r.lag} className="py-1 text-right font-medium">
                    {lagLabel(r.lag)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-1">계수</td>
                {rows.map((r) => (
                  <td key={r.lag} className={`py-1 text-right ${r.lag === best ? "font-bold text-blue-800" : ""}`}>
                    {r.r === null ? "—" : r.r.toFixed(2)}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="py-1">비교한 달 쌍</td>
                {rows.map((r) => (
                  <td key={r.lag} className="py-1 text-right">
                    {r.n}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p>월별 합계 기준이며 개별 로트의 출고 시점은 아님.</p>
        </div>
      </details>
    </div>
  );
}
