"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";
import { formatINR, formatDate, CUSTOMER_PO_STATUS_LABEL, statusPillClass } from "@/lib/finance";
import { DataTable } from "@/components/DataTable";

interface CustomerPoRow {
  id: string;
  poNumber: string;
  poDate: string;
  status: string;
  total: string;
  customer: { id: string; name: string };
  order: { id: string; orderNumber: string } | null;
  invoice: { id: string; invoiceNumber: string; status: string } | null;
}

export default function CustomerPurchaseOrdersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_orders");

  const [rows, setRows] = useState<CustomerPoRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api<CustomerPoRow[]>("/customer-purchase-orders").then(setRows).catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }
  useEffect(load, []);

  return (
    <div className="space-y-6 max-w-6xl" data-testid="customer-pos-page">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Customer POs</h1>
          <p className="mt-1 text-sm text-gray-500">Purchase orders customers send us - always optional, but links the job to the invoice we issue for it. Recording one never blocks creating or invoicing an order.</p>
        </div>
        {canManage && (
          <Link href="/customer-pos/new" className="btn-primary px-4 py-2 text-sm self-start sm:self-auto">+ Record Customer PO</Link>
        )}
      </div>

      {error && <p className="text-sm text-red-600 print:hidden">{error}</p>}

      <DataTable
        storageKey="customer-pos"
        title="Customer POs"
        rows={rows}
        rowKey={(r) => r.id}
        emptyMessage="No customer POs recorded yet."
        columns={[
          {
            key: "poNumber",
            label: "PO #",
            accessor: (r) => r.poNumber,
            filterType: "text",
            alwaysVisible: true,
            render: (r) => <Link href={`/customer-pos/${r.id}`} className="font-mono text-xs font-semibold text-[var(--theme-accent)] hover:underline">{r.poNumber}</Link>,
          },
          { key: "customer", label: "Customer", accessor: (r) => r.customer.name, filterType: "text" },
          { key: "poDate", label: "Date", accessor: (r) => formatDate(r.poDate), filterType: "text" },
          { key: "total", label: "Total", accessor: (r) => r.total, filterType: "text", render: (r) => formatINR(r.total) },
          { key: "order", label: "Order", accessor: (r) => r.order?.orderNumber ?? "" },
          { key: "invoice", label: "Invoice", accessor: (r) => r.invoice?.invoiceNumber ?? "" },
          { key: "status", label: "Status", accessor: (r) => CUSTOMER_PO_STATUS_LABEL[r.status] ?? r.status, render: (r) => <span className={statusPillClass(r.status)}>{CUSTOMER_PO_STATUS_LABEL[r.status] ?? r.status}</span> },
        ]}
      >
        {(filteredRows) => (
          <div className="cards-mobile">
            {filteredRows.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                {rows.length === 0 ? "No customer POs recorded yet." : "No rows match the current filters."}
              </div>
            ) : filteredRows.map((r) => (
              <Link key={r.id} href={`/customer-pos/${r.id}`} className="data-card block">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <span className="font-mono text-xs font-semibold text-gray-900">{r.poNumber}</span>
                  <span className={statusPillClass(r.status)}>{CUSTOMER_PO_STATUS_LABEL[r.status] ?? r.status}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900 truncate">{r.customer.name}</p>
                <div className="data-card-row"><span className="label">Total</span><span className="value font-semibold">{formatINR(r.total)}</span></div>
                {r.order && <div className="data-card-row"><span className="label">Order</span><span className="value">{r.order.orderNumber}</span></div>}
              </Link>
            ))}
          </div>
        )}
      </DataTable>
    </div>
  );
}
