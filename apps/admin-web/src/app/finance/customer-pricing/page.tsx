"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { api } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";

interface Customer {
  id: string;
  name: string;
}
interface Product {
  id: string;
  name: string;
  model: string;
}
interface SavedItem {
  id: string;
  name: string;
  standardPrice: string;
}
interface ProductPriceRow {
  id: string;
  productId: string;
  productName: string;
  productModel: string;
  silencerType: number | null;
  price: string;
}
interface SavedItemPriceRow {
  id: string;
  savedItemId: string;
  name: string;
  standardPrice: string;
  price: string;
}

export default function CustomerPricingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_quotations") || hasPermission("manage_invoices");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [customerId, setCustomerId] = useState("");

  const [productPrices, setProductPrices] = useState<ProductPriceRow[]>([]);
  const [savedItemPrices, setSavedItemPrices] = useState<SavedItemPriceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newProductId, setNewProductId] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newSavedItemId, setNewSavedItemId] = useState("");
  const [newSavedItemPrice, setNewSavedItemPrice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canManage) return;
    api<Customer[]>("/customers").then(setCustomers).catch(() => {});
    api<Product[]>("/meta/products").then(setProducts).catch(() => {});
    api<SavedItem[]>("/saved-items").then(setSavedItems).catch(() => {});
  }, [canManage]);

  const loadPricing = useCallback(() => {
    if (!customerId) {
      setProductPrices([]);
      setSavedItemPrices([]);
      return;
    }
    setLoading(true);
    setError(null);
    api<{ products: ProductPriceRow[]; savedItems: SavedItemPriceRow[] }>(`/customer-pricing?customerId=${customerId}`)
      .then((data) => {
        setProductPrices(data.products);
        setSavedItemPrices(data.savedItems);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pricing"))
      .finally(() => setLoading(false));
  }, [customerId]);

  useEffect(loadPricing, [loadPricing]);

  async function saveProductPrice(productId: string, price: string) {
    if (!customerId || !price) return;
    setSaving(true);
    setError(null);
    try {
      await api("/customer-pricing/products", { method: "PUT", body: JSON.stringify({ customerId, productId, price: parseFloat(price) }) });
      loadPricing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save price");
    } finally {
      setSaving(false);
    }
  }

  async function removeProductPrice(id: string) {
    setSaving(true);
    setError(null);
    try {
      await api(`/customer-pricing/products/${id}`, { method: "DELETE" });
      loadPricing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove price");
    } finally {
      setSaving(false);
    }
  }

  async function saveSavedItemPrice(savedItemId: string, price: string) {
    if (!customerId || !price) return;
    setSaving(true);
    setError(null);
    try {
      await api("/customer-pricing/saved-items", { method: "PUT", body: JSON.stringify({ customerId, savedItemId, price: parseFloat(price) }) });
      loadPricing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save price");
    } finally {
      setSaving(false);
    }
  }

  async function removeSavedItemPrice(id: string) {
    setSaving(true);
    setError(null);
    try {
      await api(`/customer-pricing/saved-items/${id}`, { method: "DELETE" });
      loadPricing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove price");
    } finally {
      setSaving(false);
    }
  }

  const unpricedProducts = products.filter((p) => !productPrices.some((pp) => pp.productId === p.id));
  const unpricedSavedItems = savedItems.filter((i) => !savedItemPrices.some((sp) => sp.savedItemId === i.id));

  if (!canManage) {
    return <p className="text-sm text-gray-500">You don&apos;t have permission to view this page.</p>;
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>
          Customer Pricing
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Negotiated prices for a specific customer - override the standard price of a RECD
          product or a saved billing item, per customer. These auto-fill (but stay editable) when
          creating a quotation or invoice for this customer, and the assistant offers them too.
        </p>
      </div>

      <div className="card p-4 sm:p-6">
        <label className="block text-xs font-medium text-gray-500 mb-1">Customer</label>
        <select className="field w-full sm:w-96" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">Select a customer</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

      {customerId && (
        <>
          <section className="card p-4 sm:p-6">
            <h2 className="text-base font-semibold mb-3">Product prices</h2>
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="space-y-2">
                {productPrices.length === 0 && <p className="text-sm text-gray-400">No product price overrides for this customer yet.</p>}
                {productPrices.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-gray-500 px-0.5">
                    <span className="flex-1 min-w-[12rem]">Product</span>
                    <span className="w-20">Silencer Type</span>
                    <span className="w-32">Price</span>
                  </div>
                )}
                {productPrices.map((pp) => (
                  <PriceRow
                    key={pp.id}
                    label={`${pp.productName} (${pp.productModel})`}
                    middle={<span className="w-20 text-gray-600">{pp.silencerType ?? "-"}</span>}
                    price={pp.price}
                    onSave={(price) => saveProductPrice(pp.productId, price)}
                    onRemove={() => removeProductPrice(pp.id)}
                    saving={saving}
                  />
                ))}
                {unpricedProducts.length > 0 && (
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-100 mt-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Add product</label>
                      <select className="field" value={newProductId} onChange={(e) => setNewProductId(e.target.value)}>
                        <option value="">Select a product</option>
                        {unpricedProducts.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.model})</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Price (₹)"
                      className="field w-32"
                      value={newProductPrice}
                      onChange={(e) => setNewProductPrice(e.target.value)}
                    />
                    <button
                      className="btn-primary px-4 py-2 text-sm"
                      disabled={!newProductId || !newProductPrice || saving}
                      onClick={async () => {
                        await saveProductPrice(newProductId, newProductPrice);
                        setNewProductId("");
                        setNewProductPrice("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="card p-4 sm:p-6">
            <h2 className="text-base font-semibold mb-3">Saved item prices</h2>
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="space-y-2">
                {savedItemPrices.length === 0 && <p className="text-sm text-gray-400">No saved item price overrides for this customer yet.</p>}
                {savedItemPrices.map((sp) => (
                  <PriceRow
                    key={sp.id}
                    label={`${sp.name} (standard: ₹${Number(sp.standardPrice).toLocaleString("en-IN")})`}
                    price={sp.price}
                    onSave={(price) => saveSavedItemPrice(sp.savedItemId, price)}
                    onRemove={() => removeSavedItemPrice(sp.id)}
                    saving={saving}
                  />
                ))}
                {unpricedSavedItems.length > 0 && (
                  <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-gray-100 mt-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Add saved item</label>
                      <select className="field" value={newSavedItemId} onChange={(e) => setNewSavedItemId(e.target.value)}>
                        <option value="">Select a saved item</option>
                        {unpricedSavedItems.map((i) => (
                          <option key={i.id} value={i.id}>{i.name} (standard: ₹{Number(i.standardPrice).toLocaleString("en-IN")})</option>
                        ))}
                      </select>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Price (₹)"
                      className="field w-32"
                      value={newSavedItemPrice}
                      onChange={(e) => setNewSavedItemPrice(e.target.value)}
                    />
                    <button
                      className="btn-primary px-4 py-2 text-sm"
                      disabled={!newSavedItemId || !newSavedItemPrice || saving}
                      onClick={async () => {
                        await saveSavedItemPrice(newSavedItemId, newSavedItemPrice);
                        setNewSavedItemId("");
                        setNewSavedItemPrice("");
                      }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function PriceRow({
  label,
  middle,
  price,
  onSave,
  onRemove,
  saving,
}: {
  label: string;
  middle?: ReactNode;
  price: string;
  onSave: (price: string) => void;
  onRemove: () => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(price);
  const dirty = value !== price;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex-1 min-w-[12rem] text-gray-800">{label}</span>
      {middle}
      <input
        type="number"
        min={0}
        step="0.01"
        className="field w-32"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
        disabled={!dirty || saving}
        onClick={() => onSave(value)}
      >
        Save
      </button>
      <button className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50" disabled={saving} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}
