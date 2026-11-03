import { customerPeriod, getCustomerItems, type CustomerItem } from "@/lib/customers";
import { qtyText, stockUnits } from "@/lib/request";
import { formatShort } from "@/lib/format";
import { StatusBadge, stockStatus } from "@/lib/stockDisplay";
import Link from "next/link";
import { notFound } from "next/navigation";

/** 거래처의 최근 12개월 정상 출고 품목 → 품목 상세. 확인 필요 품목은 아래에 모은다 */
export default async function CustomerItemsPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code);
  const period = await customerPeriod();
  if (!period) notFound();
  const data = await getCustomerItems(code, period);
  if (!data) notFound();
  const { customer, checked, unchecked } = data;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-4">
      <Link href="/stock/customers" className="text-sm text-blue-600">
        ← 거래처 검색
      </Link>
      <header>
        <h1 data-testid="customer-name" className="break-words text-lg font-bold">
          {customer.name}
        </h1>
        <p data-testid="customer-period" className="num text-xs text-zinc-500">
          최근 12개월 정상 출고 품목 · {period.fromYm} ~ {period.toYm} ({period.basis === "complete" ? "집계 완료 마지막 달 기준" : "자료가 있는 마지막 달 기준"}) · 출고 건수 많은 순
        </p>
        <p className="num text-xs text-zinc-500">
          {checked.length + unchecked.length}개 품목 · 재고 확인 {checked.length} · 확인 필요 {unchecked.length} · 현재 재고는 확인 재고 기준
        </p>
      </header>
      {checked.length + unchecked.length === 0 && (
        <p className="rounded-lg border border-zinc-200 p-4 text-center text-sm text-zinc-500">이 기간에 정상 출고한 품목이 없습니다.</p>
      )}
      {checked.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200">
          {checked.map((i) => (
            <Row key={i.code} item={i} customer={customer.code} />
          ))}
        </ul>
      )}
      {unchecked.length > 0 && (
        <section data-testid="customer-unchecked">
          <h2 className="mb-1 text-sm font-semibold text-zinc-600">확인 필요 {unchecked.length}개 — 최근 재고 파일에 없음</h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-dashed border-zinc-400">
            {unchecked.map((i) => (
              <Row key={i.code} item={i} customer={customer.code} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Row({ item, customer }: { item: CustomerItem; customer: string }) {
  const st = stockStatus(item.stock);
  const units = stockUnits({ available: item.stock.available, unitsPerBox: item.unitsPerBox });
  const at = item.stock.stockAsOf ?? item.stock.uploadedAt;
  return (
    <li>
      <Link
        href={`/stock/${encodeURIComponent(item.code)}?customer=${encodeURIComponent(customer)}`}
        data-testid="customer-item"
        data-code={item.code}
        className="flex min-h-12 flex-col gap-0.5 px-3 py-2 hover:bg-blue-50"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
          <StatusBadge status={st} />
        </span>
        <span className="num flex flex-wrap gap-x-3 text-xs text-zinc-600">
          <span className="font-mono text-zinc-500">{item.code}</span>
          <span>
            현재{" "}
            <b data-testid="customer-item-qty" className="text-zinc-900">
              {units === null ? "확인 필요" : qtyText(units, item)}
            </b>
          </span>
          {units !== null && at && <span data-testid="customer-item-asof">집계 {formatShort(at)}</span>}
          <span>
            출고 {item.shipments.toLocaleString()}회 · {item.qtyUnits.toLocaleString()}개 · 최근 {item.lastShipDate}
          </span>
        </span>
      </Link>
    </li>
  );
}
