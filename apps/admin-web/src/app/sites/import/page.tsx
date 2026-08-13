"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { api } from "@/lib/apiClient";

interface Customer {
  id: string;
  name: string;
}

interface ImportRow {
  companyName: string;
  address: string;
  area: string;
  quantity: number;
  deliveryStatus: string;
  statusNote: string;
  priority: string;
  contactName: string;
  contactPhone: string;
  docsToCarry: string;
}

// Maps the common column headers seen in delivery-tracking sheets (e.g. "Material Delivery
// Status contact.xlsx": Product, QTY, Customer Name, Location, area, Material Delivery
// Status, Status, Priority, Contact Person, Contact No., Docs To Carry) to our row shape.
// Matching is case-insensitive and tolerant of trailing spaces, since sheet headers are
// hand-typed and inconsistent.
const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  companyName: ["customer name", "company name", "end client", "site owner"],
  address: ["location", "address"],
  area: ["area", "city"],
  quantity: ["qty", "quantity"],
  deliveryStatus: ["material delivery status", "delivery status"],
  statusNote: ["status", "status note"],
  priority: ["priority"],
  contactName: ["contact person", "contact name"],
  contactPhone: ["contact no.", "contact no", "contact number", "phone"],
  docsToCarry: ["docs to carry", "documents", "docs"],
};

function normalizeHeader(h: string) {
  return h.trim().toLowerCase();
}

function parseSheet(rows: Record<string, unknown>[]): ImportRow[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const columnFor: Partial<Record<keyof ImportRow, string>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof ImportRow, string[]][]) {
    const match = headers.find((h) => aliases.includes(normalizeHeader(h)));
    if (match) columnFor[field] = match;
  }

  return rows
    .map((row) => {
      const get = (field: keyof ImportRow) => {
        const col = columnFor[field];
        const v = col ? row[col] : undefined;
        return v == null ? "" : String(v).trim();
      };
      return {
        companyName: get("companyName"),
        address: get("address"),
        area: get("area"),
        quantity: parseInt(get("quantity"), 10) || 1,
        deliveryStatus: get("deliveryStatus").toLowerCase().includes("delivered")
          ? "delivered"
          : get("deliveryStatus").toLowerCase().includes("transit")
            ? "in_transit"
            : "pending",
        statusNote: get("statusNote"),
        priority: get("priority"),
        contactName: get("contactName"),
        contactPhone: get("contactPhone"),
        docsToCarry: get("docsToCarry"),
      };
    })
    // Skip fully blank rows (the source sheet often has placeholder rows with only a product/qty).
    .filter((r) => r.companyName || r.address || r.contactName);
}

export default function ImportSitesPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    api<Customer[]>("/customers").then(setCustomers).catch(() => {});
  }, []);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const parsed = parseSheet(json);
      if (parsed.length === 0) {
        setError("No rows found - check that the sheet has a header row with columns like Customer Name / Location / Contact Person.");
      }
      setRows(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read the file");
    }
  }

  function updateRow(index: number, patch: Partial<ImportRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function submitImport() {
    if (!customerId) {
      setError("Choose the customer these sites are contracted under first.");
      return;
    }
    if (rows.length === 0) {
      setError("Nothing to import.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await api<{ imported: number }>("/sites/bulk-import", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          rows: rows.map((r) => ({
            companyName: r.companyName || undefined,
            address: r.address || undefined,
            area: r.area || undefined,
            quantity: r.quantity || 1,
            deliveryStatus: r.deliveryStatus || undefined,
            statusNote: r.statusNote || undefined,
            priority: r.priority ? parseInt(r.priority, 10) : undefined,
            contactName: r.contactName || undefined,
            contactPhone: r.contactPhone || undefined,
            docsToCarry: r.docsToCarry || undefined,
          })),
        }),
      });
      setResult(`Imported ${res.imported} site${res.imported === 1 ? "" : "s"}.`);
      setRows([]);
      setFileName("");
      setTimeout(() => router.push("/sites"), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold" style={{ color: "var(--text-heading)" }}>
          Import sites
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a spreadsheet (e.g. a delivery-tracking sheet) to create multiple site addresses under one customer
          in one go. Each row becomes one site, with its own end-client name, address, contact, and delivery status -
          all editable afterward.
        </p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}
      {result && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">{result}</div>}

      <section className="card p-5 space-y-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Customer (who we're contracted with)</label>
          <select
            className="w-full sm:w-96 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Spreadsheet (.xlsx, .xls, .csv)</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          {fileName && <p className="mt-1 text-xs text-gray-400">Loaded: {fileName} - {rows.length} row(s) parsed</p>}
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card overflow-hidden">
          <div className="table-scroll">
            <table className="w-full border-collapse text-xs">
              <thead className="bg-gray-50 text-left font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2">End-client</th>
                  <th className="px-3 py-2">Address</th>
                  <th className="px-3 py-2">Area</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Delivery status</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Contact</th>
                  <th className="px-3 py-2">Phone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <input className="w-32 rounded border border-gray-200 px-1.5 py-1" value={r.companyName} onChange={(e) => updateRow(i, { companyName: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-40 rounded border border-gray-200 px-1.5 py-1" value={r.address} onChange={(e) => updateRow(i, { address: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-24 rounded border border-gray-200 px-1.5 py-1" value={r.area} onChange={(e) => updateRow(i, { area: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" min={1} className="w-14 rounded border border-gray-200 px-1.5 py-1" value={r.quantity} onChange={(e) => updateRow(i, { quantity: parseInt(e.target.value, 10) || 1 })} />
                    </td>
                    <td className="px-2 py-1">
                      <select className="rounded border border-gray-200 px-1.5 py-1" value={r.deliveryStatus} onChange={(e) => updateRow(i, { deliveryStatus: e.target.value })}>
                        <option value="pending">Pending</option>
                        <option value="in_transit">In transit</option>
                        <option value="delivered">Delivered</option>
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-14 rounded border border-gray-200 px-1.5 py-1" value={r.priority} onChange={(e) => updateRow(i, { priority: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-28 rounded border border-gray-200 px-1.5 py-1" value={r.contactName} onChange={(e) => updateRow(i, { contactName: e.target.value })} />
                    </td>
                    <td className="px-2 py-1">
                      <input className="w-28 rounded border border-gray-200 px-1.5 py-1" value={r.contactPhone} onChange={(e) => updateRow(i, { contactPhone: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4">
            <button type="button" onClick={submitImport} disabled={importing} className="btn-primary px-4 py-2 text-sm">
              {importing ? "Importing…" : `Import ${rows.length} site${rows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
