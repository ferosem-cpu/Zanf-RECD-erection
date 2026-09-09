"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";

interface OtherSite {
  id: string;
  address: string | null;
  companyName: string | null;
  gpsLat: string | null;
  gpsLng: string | null;
  currentStage: { label: string };
  order: { orderNumber: string };
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  quantity: number;
  value: string;
  orderDate: string;
  promisedDeliveryDate: string | null;
  actualDispatchDate: string | null;
  plannedExhaustHookupType: string | null;
  customerPoNumber: string | null;
  customerPoDate: string | null;
  customer: {
    id: string;
    name: string;
    address: string | null;
    gstin: string | null;
    contacts: { name: string; phone: string | null; email: string | null }[];
  };
  product: { id: string; name: string; model: string; ratingSpec: string | null; capacityKva: string | null };
  lineItems: Array<{ id: string; quantity: number; product: { id: string; name: string; model: string } }>;
  salesEngineer: { name: string } | null;
  site: {
    id: string;
    address: string | null;
    companyName: string | null;
    gpsLat: string | null;
    gpsLng: string | null;
    currentStage: { label: string };
    assignedEngineer: { name: string } | null;
    vendor: { name: string } | null;
  } | null;
  otherCustomerSites: OtherSite[];
}

interface Product {
  id: string;
  name: string;
  model: string;
  ratingSpec: string | null;
}

function mapsUrl(address: string | null, lat: string | null, lng: string | null): string | null {
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return null;
}

// yyyy-MM-dd for a <input type="date"> value - undefined/null becomes "" (empty date input).
function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_orders");
  // Same gate as /finance/customer-pricing - order-only users won't see pricing hints.
  const canViewPricing = hasPermission("manage_quotations") || hasPermission("manage_invoices");
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit form
  const [editing, setEditing] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [editProductId, setEditProductId] = useState("");
  const [editQuantity, setEditQuantity] = useState(1);
  const [editValue, setEditValue] = useState("");
  const [editOrderDate, setEditOrderDate] = useState("");
  const [editPromisedDate, setEditPromisedDate] = useState("");
  const [editDispatchDate, setEditDispatchDate] = useState("");
  const [editExhaustHookup, setEditExhaustHookup] = useState("");
  const [editPoNumber, setEditPoNumber] = useState("");
  const [editPoDate, setEditPoDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // This customer's negotiated product prices (productId -> price) - drives the "Update
  // pricing" hint and the "Use ₹X" quick-fill button on the edit form's Order value field.
  const [customerProductPrices, setCustomerProductPrices] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    api<OrderDetail>(`/orders/${id}`).then(setOrder).catch((e) => setError(e instanceof Error ? e.message : "Failed to load order"));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!canViewPricing || !order) {
      setCustomerProductPrices({});
      return;
    }
    api<{ products: { productId: string; price: string }[] }>(`/customer-pricing?customerId=${order.customer.id}`)
      .then((data) => setCustomerProductPrices(Object.fromEntries(data.products.map((p) => [p.productId, p.price]))))
      .catch(() => setCustomerProductPrices({}));
  }, [canViewPricing, order?.customer.id]);

  async function deleteOrder() {
    if (!order) return;
    if (!window.confirm(`Delete order ${order.orderNumber}? This also removes its site and cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/orders/${id}`, { method: "DELETE" });
      router.push("/orders");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete order");
      setDeleting(false);
    }
  }

  async function openEdit() {
    if (!order) return;
    setSaveError(null);
    setEditProductId(order.product ? products.find((p) => p.name === order.product.name && p.model === order.product.model)?.id ?? "" : "");
    setEditQuantity(order.quantity);
    setEditValue(order.value != null ? String(order.value) : "");
    setEditOrderDate(toDateInputValue(order.orderDate));
    setEditPromisedDate(toDateInputValue(order.promisedDeliveryDate));
    setEditDispatchDate(toDateInputValue(order.actualDispatchDate));
    setEditExhaustHookup(order.plannedExhaustHookupType ?? "");
    setEditPoNumber(order.customerPoNumber ?? "");
    setEditPoDate(toDateInputValue(order.customerPoDate));
    setEditing(true);
    if (products.length === 0) {
      try {
        const productsData = await api<Product[]>("/products");
        setProducts(productsData);
        const match = productsData.find((p) => p.name === order.product.name && p.model === order.product.model);
        if (match) setEditProductId(match.id);
      } catch (err) {
        console.error("Failed to load products", err);
      }
    }
  }

  async function saveEdit() {
    if (!order) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api<OrderDetail>(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          productId: editProductId || undefined,
          quantity: editQuantity,
          value: editValue === "" ? null : Number(editValue),
          orderDate: editOrderDate ? new Date(editOrderDate).toISOString() : undefined,
          promisedDeliveryDate: editPromisedDate ? new Date(editPromisedDate).toISOString() : null,
          actualDispatchDate: editDispatchDate ? new Date(editDispatchDate).toISOString() : null,
          plannedExhaustHookupType: editExhaustHookup || null,
          customerPoNumber: editPoNumber || null,
          customerPoDate: editPoDate ? new Date(editPoDate).toISOString() : null,
        }),
      });
      setOrder({ ...order, ...updated });
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  if (error && !order) return <p className="text-sm text-red-600">{error}</p>;
  if (!order) return <p className="text-sm text-gray-500">Loading...</p>;

  // The product id the edit form is currently pricing against - the explicitly picked
  // replacement, or (while it's "Keep current") the current product's own id.
  const effectiveEditProductId = editProductId || order.product.id;
  const editProductPrice = customerProductPrices[effectiveEditProductId];

  // Cumulative customer-price cost across every product on this order/site - the main
  // product (at effectiveEditProductId/editQuantity) plus every additional RECD unit in
  // lineItems (each at its own quantity) - so "Populate cost" totals correctly when a site
  // has more than one product, not just the one currently being edited.
  const costParts = [
    { label: `${order.product.name} (${order.product.model})`, price: customerProductPrices[effectiveEditProductId], quantity: editQuantity },
    ...order.lineItems.map((li) => ({
      label: `${li.product.name} (${li.product.model})`,
      price: customerProductPrices[li.product.id],
      quantity: li.quantity,
    })),
  ];
  const cumulativeCost = costParts.reduce((sum, part) => sum + (part.price ? parseFloat(part.price) * part.quantity : 0), 0);
  const anyPriced = costParts.some((part) => part.price);
  const allPriced = costParts.every((part) => part.price);

  const contact = order.customer.contacts[0];
  const siteMap = order.site ? mapsUrl(order.site.address, order.site.gpsLat, order.site.gpsLng) : null;

  return (
    <div className="space-y-6 max-w-4xl" data-testid="order-detail-page">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/orders" className="text-xs font-medium text-gray-400 hover:text-gray-600">← Orders</Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold" style={{ color: "var(--text-heading)" }}>{order.orderNumber}</h1>
          <p className="text-sm text-gray-500">
            {order.customer.name} · Placed {new Date(order.orderDate).toLocaleDateString()}
            {order.salesEngineer && <> · Sales: {order.salesEngineer.name}</>}
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={openEdit}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap"
            >
              Edit order
            </button>
            <button
              type="button"
              onClick={deleteOrder}
              disabled={deleting}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 whitespace-nowrap"
            >
              {deleting ? "Deleting…" : "Delete order"}
            </button>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      {editing && (
        <section className="card p-5 space-y-4 border-l-4" style={{ borderLeftColor: "var(--theme-accent)" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Edit order</h2>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Product</label>
              <select className="field w-full" value={editProductId} onChange={(e) => setEditProductId(e.target.value)}>
                <option value="">Keep current ({order.product.name} {order.product.model})</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.model}){p.ratingSpec ? ` — ${p.ratingSpec}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Quantity</label>
              <input type="number" min={1} className="field w-full" value={editQuantity} onChange={(e) => setEditQuantity(Math.max(1, Number(e.target.value) || 1))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Order value (₹)</label>
              <input type="number" min={0} className="field w-full" value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder="Leave blank to clear" />
              {canViewPricing && (
                anyPriced ? (
                  <p className="mt-1 text-[11px] text-gray-400">
                    {order.lineItems.length > 0
                      ? `Cumulative customer price (${costParts.length} products on this order): ₹${cumulativeCost.toLocaleString("en-IN")}`
                      : `Customer price: ₹${Number(editProductPrice ?? 0).toLocaleString("en-IN")}/unit`}
                    {" · "}
                    <button
                      type="button"
                      className="font-medium text-[var(--theme-accent)]"
                      onClick={() => setEditValue(cumulativeCost.toFixed(2))}
                    >
                      Populate cost
                    </button>
                    {!allPriced && (
                      <span className="text-amber-600">
                        {" "}(no pricing for {costParts.filter((p) => !p.price).length} of {costParts.length} products — counted as ₹0)
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-amber-600">
                    No customer pricing set for {order.lineItems.length > 0 ? "any product on this order" : "this product"} ·{" "}
                    <a href={`/finance/customer-pricing?customer=${order.customer.id}`} target="_blank" rel="noreferrer" className="font-medium text-[var(--theme-accent)]">
                      Add pricing
                    </a>
                  </p>
                )
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Order date</label>
              <input type="date" className="field w-full" value={editOrderDate} onChange={(e) => setEditOrderDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Promised delivery</label>
              <input type="date" className="field w-full" value={editPromisedDate} onChange={(e) => setEditPromisedDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Actual dispatch</label>
              <input type="date" className="field w-full" value={editDispatchDate} onChange={(e) => setEditDispatchDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Planned exhaust hookup</label>
              <select className="field w-full" value={editExhaustHookup} onChange={(e) => setEditExhaustHookup(e.target.value)}>
                <option value="">Not set</option>
                <option value="replace_existing_silencer">Replace existing silencer</option>
                <option value="add_after_existing_exhaust">Add after existing exhaust</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Customer PO number</label>
              <input type="text" className="field w-full" value={editPoNumber} onChange={(e) => setEditPoNumber(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Customer PO date</label>
              <input type="date" className="field w-full" value={editPoDate} onChange={(e) => setEditPoDate(e.target.value)} />
            </div>
          </div>

          {saveError && <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{saveError}</div>}

          <div className="flex gap-2">
            <button type="button" onClick={saveEdit} disabled={saving} className="btn-primary px-4 py-2 text-sm font-semibold disabled:opacity-50">
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold">Customer</h2>
          <p className="text-sm text-gray-700">{order.customer.name}</p>
          <p className="text-sm text-gray-500 whitespace-pre-line">{order.customer.address ?? "No address on file"}</p>
          {order.customer.gstin && <p className="text-xs text-gray-400">GSTIN: {order.customer.gstin}</p>}
          {contact && (
            <p className="text-xs text-gray-500 pt-1">
              Contact: {contact.name}{contact.phone && <> · {contact.phone}</>}{contact.email && <> · {contact.email}</>}
            </p>
          )}
        </section>

        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold">Product</h2>
          <p className="text-sm text-gray-700">{order.product.name} ({order.product.model})</p>
          {order.product.ratingSpec && <p className="text-xs text-gray-500">{order.product.ratingSpec}</p>}
          <div className="data-card-row">
            <span className="label">Quantity</span>
            <span className="value">{order.quantity}</span>
          </div>
          <div className="data-card-row">
            <span className="label">Order value</span>
            <span className="value font-semibold">₹{Number(order.value).toLocaleString("en-IN")}</span>
          </div>
          {canViewPricing && (
            <p className="text-[11px] text-gray-400">
              <a href={`/finance/customer-pricing?customer=${order.customer.id}`} target="_blank" rel="noreferrer" className="font-medium text-[var(--theme-accent)]">
                Update customer pricing
              </a>
            </p>
          )}
          {order.lineItems.length > 0 && (
            <div className="pt-2 border-t border-gray-100 space-y-1">
              <p className="text-xs text-gray-500">Additional units on this order</p>
              {order.lineItems.map((li) => (
                <p key={li.id} className="text-sm text-gray-700">
                  {li.product.name} ({li.product.model}) · Qty {li.quantity}
                </p>
              ))}
            </div>
          )}
        </section>

        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold">Dates</h2>
          <div className="data-card-row">
            <span className="label">Order date</span>
            <span className="value">{new Date(order.orderDate).toLocaleDateString()}</span>
          </div>
          <div className="data-card-row">
            <span className="label">Promised delivery</span>
            <span className="value">{order.promisedDeliveryDate ? new Date(order.promisedDeliveryDate).toLocaleDateString() : "-"}</span>
          </div>
          <div className="data-card-row">
            <span className="label">Actual dispatch</span>
            <span className="value">{order.actualDispatchDate ? new Date(order.actualDispatchDate).toLocaleDateString() : "-"}</span>
          </div>
          {order.customerPoNumber && (
            <div className="data-card-row">
              <span className="label">Customer PO</span>
              <span className="value">{order.customerPoNumber}</span>
            </div>
          )}
        </section>

        <section className="card p-5 space-y-2">
          <h2 className="text-sm font-semibold">Installation site</h2>
          {order.site ? (
            <>
              <div className="data-card-row">
                <span className="label">Site name</span>
                <span className="value">{order.site.companyName ?? "Not set"}</span>
              </div>
              <div className="data-card-row">
                <span className="label">Stage</span>
                <span className="value">{order.site.currentStage.label}</span>
              </div>
              <div className="data-card-row">
                <span className="label">Engineer</span>
                <span className="value">{order.site.assignedEngineer?.name ?? "Unassigned"}</span>
              </div>
              <div className="data-card-row">
                <span className="label">Vendor</span>
                <span className="value">{order.site.vendor?.name ?? "Internal"}</span>
              </div>
              <p className="text-sm text-gray-500 pt-1 whitespace-pre-line">{order.site.address ?? "No site address on file"}</p>
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href={`/sites/${order.site.id}`} className="btn-primary px-3 py-1.5 text-xs">Open site progress</Link>
                {siteMap && (
                  <a href={siteMap} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    📍 View on Google Maps
                  </a>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">No site record.</p>
          )}
        </section>
      </div>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-medium text-gray-600">
            {order.otherCustomerSites.length > 0
              ? `Other sites for ${order.customer.name} (${order.otherCustomerSites.length})`
              : `Sites for ${order.customer.name}`}
          </h2>
          {canManage && (
            <Link
              href={`/orders?customer=${order.customer.id}`}
              className="text-xs font-medium text-[var(--theme-accent)] whitespace-nowrap"
            >
              + Add site
            </Link>
          )}
        </div>
        <p className="mb-3 text-xs text-gray-400">
          A customer can have multiple installation sites - each one gets its own address/location and progress tracking.
        </p>
        {order.otherCustomerSites.length === 0 && (
          <p className="text-sm text-gray-400">No other sites for this customer yet.</p>
        )}
        {order.otherCustomerSites.length > 0 && (
          <div className="cards-mobile sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
            {order.otherCustomerSites.map((s) => {
              const otherMap = mapsUrl(s.address, s.gpsLat, s.gpsLng);
              return (
                <div key={s.id} className="data-card">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <Link href={`/sites/${s.id}`} className="font-mono text-xs font-semibold hover:underline" style={{ color: "var(--theme-primary)" }}>
                      {s.order.orderNumber}
                    </Link>
                    <span className="badge badge-accent">{s.currentStage.label}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 truncate">{s.companyName ?? "Unnamed site"}</p>
                  <p className="text-xs text-gray-500 mb-2 truncate">{s.address ?? "No address on file"}</p>
                  {otherMap && (
                    <a href={otherMap} target="_blank" rel="noreferrer" className="text-xs font-medium" style={{ color: "var(--theme-accent)" }}>
                      📍 View on Google Maps
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
