"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { formatINR, formatDate, BILL_STATUS_LABEL, statusPillClass } from "@/lib/finance";

interface BillAllocationRow {
  id: string;
  amount: string;
  bill: { id: string; billNumber: string; status: string; billDate: string; supplier: { id: string; name: string } };
  invoice: { id: string; invoiceNumber: string; docType: string } | null;
}
interface ExpenseRow { id: string; description: string; amount: string; expenseDate: string; category: { label: string } }
interface PoRow { id: string; poNumber: string; status: string; total: string; orderDate: string }
interface CostsResponse {
  billAllocations: BillAllocationRow[];
  expenses: ExpenseRow[];
  purchaseOrders: PoRow[];
  totals: { billAllocations: string; expenses: string; purchaseOrders: string; grandTotal: string };
}

/** Site detail page's "Costs" section - approved vendor-invoice allocations + the expense
 * book + purchase orders for this site, from GET /sites/:id/costs. Degrades quietly (renders
 * nothing) if the endpoint 403s for this user's role, rather than showing an error banner for
 * a section they simply can't see. */
export function SiteCostsSection({ siteId }: { siteId: string }) {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    api<CostsResponse>(`/sites/${siteId}/costs`)
      .then(setData)
      .catch((e) => {
        if (e instanceof Error && e.message.includes("403")) setForbidden(true);
      });
  }, [siteId]);

  if (forbidden) return null;
  if (!data) return null;

  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-gray-600">Costs</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        <div className="kpi-tile">
          <p className="text-xs text-gray-500">Vendor invoices</p>
          <p className="text-lg font-semibold mt-1">{formatINR(data.totals.billAllocations)}</p>
        </div>
        <div className="kpi-tile">
          <p className="text-xs text-gray-500">Expenses</p>
          <p className="text-lg font-semibold mt-1">{formatINR(data.totals.expenses)}</p>
        </div>
        <div className="kpi-tile">
          <p className="text-xs text-gray-500">Total site cost</p>
          <p className="text-lg font-semibold mt-1" style={{ color: "var(--theme-accent)" }}>{formatINR(data.totals.grandTotal)}</p>
        </div>
      </div>

      {data.billAllocations.length > 0 && (
        <div className="card overflow-hidden mb-3">
          <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wide text-gray-500">Vendor invoice allocations</div>
          <div className="divide-y divide-gray-100">
            {data.billAllocations.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <Link href={`/finance/vendor-invoices/${a.bill.id}`} className="font-medium text-[var(--theme-accent)] hover:underline">{a.bill.billNumber}</Link>
                  <span className="text-gray-500"> · {a.bill.supplier.name}</span>
                  {a.invoice && <span className="text-gray-400"> · linked to {a.invoice.invoiceNumber}</span>}
                  <span className={`ml-2 ${statusPillClass(a.bill.status)}`}>{BILL_STATUS_LABEL[a.bill.status] ?? a.bill.status}</span>
                </div>
                <span className="font-medium">{formatINR(a.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.expenses.length > 0 && (
        <div className="card overflow-hidden mb-3">
          <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wide text-gray-500">Expenses</div>
          <div className="divide-y divide-gray-100">
            {data.expenses.map((e) => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div>
                  <span className="text-gray-700">{e.description}</span>
                  <span className="text-gray-400"> · {e.category.label} · {formatDate(e.expenseDate)}</span>
                </div>
                <span className="font-medium">{formatINR(e.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.purchaseOrders.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2 border-b text-xs font-semibold uppercase tracking-wide text-gray-500">Purchase orders</div>
          <div className="divide-y divide-gray-100">
            {data.purchaseOrders.map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <Link href={`/purchase-orders/${p.id}`} className="text-[var(--theme-accent)] hover:underline">{p.poNumber}</Link>
                <span className="font-medium">{formatINR(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.billAllocations.length === 0 && data.expenses.length === 0 && data.purchaseOrders.length === 0 && (
        <p className="text-sm text-gray-400">No costs recorded against this site yet.</p>
      )}
    </section>
  );
}
