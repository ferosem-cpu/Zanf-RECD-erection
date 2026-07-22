"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { THEMES, type ThemeColors, getTheme, applyThemeToDOM } from "@/lib/themes";
import {
  getSavedThemeKey,
  saveThemeKey,
  getSavedCustomColors,
  saveCustomColors,
  clearCustomColors,
  getSavedLogo,
  saveLogo,
  clearLogo,
  fileToDataUrl,
} from "@/lib/settingsStore";
import { extractDominantColors, colorsToTheme } from "@/lib/colorExtractor";
import { api } from "@/lib/apiClient";

export default function SettingsPage() {
  const [activeTheme, setActiveTheme] = useState("slate");
  const [customColors, setCustomColors] = useState<ThemeColors | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractedPreview, setExtractedPreview] = useState<string | null>(null);
  const [dragOverLogo, setDragOverLogo] = useState(false);
  const [dragOverTheme, setDragOverTheme] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);

  // Load persisted settings on mount
  useEffect(() => {
    setActiveTheme(getSavedThemeKey());
    setCustomColors(getSavedCustomColors());
    setLogoUrl(getSavedLogo());
  }, []);

  const saveSettingsToDB = async (logo: string | null, theme: string, colors: ThemeColors | null) => {
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          logoDataUrl: logo,
          themeKey: theme,
          customColors: colors,
        }),
      });
      saveThemeKey(theme);
      if (logo) {
        saveLogo(logo);
      } else {
        clearLogo();
      }
      if (colors) {
        saveCustomColors(colors);
      } else {
        clearCustomColors();
      }
      window.dispatchEvent(new Event("settings-changed"));
    } catch (err) {
      alert("Failed to save settings to database: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  // ── Theme selection ──────────────────────────────────────────────────

  async function selectPreset(key: string) {
    const theme = getTheme(key);
    applyThemeToDOM(theme.colors);
    setActiveTheme(key);
    setCustomColors(null);
    setExtractedPreview(null);
    await saveSettingsToDB(logoUrl, key, null);
  }

  async function applyCustom(colors: ThemeColors) {
    applyThemeToDOM(colors);
    setActiveTheme("custom");
    setCustomColors(colors);
    await saveSettingsToDB(logoUrl, "custom", colors);
  }

  // ── Logo upload ──────────────────────────────────────────────────────

  const handleLogoFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await fileToDataUrl(file);
    setLogoUrl(dataUrl);
    await saveSettingsToDB(dataUrl, activeTheme, customColors);
  }, [activeTheme, customColors]);

  async function removeLogo() {
    setLogoUrl(null);
    await saveSettingsToDB(null, activeTheme, customColors);
  }

  // ── Custom theme from image ──────────────────────────────────────────

  const handleThemeImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setExtracting(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setExtractedPreview(dataUrl);
      const dominantColors = await extractDominantColors(dataUrl);
      const theme = colorsToTheme(dominantColors);
      await applyCustom(theme);
    } finally {
      setExtracting(false);
    }
  }, [logoUrl]);

  // ── Drag & drop helpers ──────────────────────────────────────────────

  function handleDrop(
    e: React.DragEvent,
    handler: (f: File) => void,
    setDrag: (v: boolean) => void
  ) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handler(file);
  }

  // ── Company & Tax details (Super Admin / manage_settings) ─────────────
  const [company, setCompany] = useState({
    legalName: "", address: "", city: "", pinCode: "", state: "", gstin: "", pan: "",
    email: "", website: "", phone: "",
    bankName: "", bankAccountNumber: "", bankIfsc: "", bankBranch: "",
    invoiceTerms: "", quotationTerms: "", purchaseOrderTerms: "", defaultTaxRatePct: "",
    documentFooterNote: "",
  });
  const [companyLoaded, setCompanyLoaded] = useState(false);
  const [companySaving, setCompanySaving] = useState(false);

  // ── Authorised signatory (name + picture) ──────────────────────────────
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryDataUrl, setSignatoryDataUrl] = useState<string | null>(null);
  const [dragOverSignatory, setDragOverSignatory] = useState(false);
  const signatoryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api("/settings").then((s: any) => {
      setCompany((c) => ({
        legalName: s.legalName ?? "", address: s.address ?? "", city: s.city ?? "", pinCode: s.pinCode ?? "",
        state: s.state ?? "", gstin: s.gstin ?? "", pan: s.pan ?? "",
        email: s.email ?? "", website: s.website ?? "", phone: s.phone ?? "",
        bankName: s.bankName ?? "", bankAccountNumber: s.bankAccountNumber ?? "",
        bankIfsc: s.bankIfsc ?? "", bankBranch: s.bankBranch ?? "", invoiceTerms: s.invoiceTerms ?? "",
        quotationTerms: s.quotationTerms ?? "", purchaseOrderTerms: s.purchaseOrderTerms ?? "",
        defaultTaxRatePct: s.defaultTaxRatePct ?? "",
        documentFooterNote: s.documentFooterNote ?? "",
      }));
      setSignatoryName(s.signatoryName ?? "");
      setSignatoryDataUrl(s.signatoryDataUrl ?? null);
      setCompanyLoaded(true);
    }).catch(() => setCompanyLoaded(true));
  }, []);

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    setCompanySaving(true);
    try {
      const payload: Record<string, unknown> = { ...company, signatoryName, signatoryDataUrl };
      if (payload.defaultTaxRatePct === "" || payload.defaultTaxRatePct === null) delete payload.defaultTaxRatePct;
      else payload.defaultTaxRatePct = parseFloat(String(payload.defaultTaxRatePct));
      await api("/settings", { method: "PUT", body: JSON.stringify(payload) });
      alert("Company & tax details saved.");
    } catch (err) {
      alert("Failed to save company details: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setCompanySaving(false);
    }
  }

  const handleSignatoryFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const dataUrl = await fileToDataUrl(file);
    setSignatoryDataUrl(dataUrl);
  }, []);

  function removeSignatoryImage() {
    setSignatoryDataUrl(null);
  }

  // ── Render ───────────────────────────────────────────────────────────

  const isCustom = activeTheme === "custom" && customColors;

  return (
    <div className="space-y-6 sm:space-y-8 max-w-4xl" data-testid="settings-page">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: "var(--text-heading)" }}>Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Customise your dashboard branding and appearance.
        </p>
      </div>

      {/* ── Company Branding ────────────────────────────────────────────── */}
      <section className="card p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-1">Company Branding</h2>
        <p className="text-sm text-gray-500 mb-5">
          Upload your company logo. It will appear in the sidebar. Accepts JPG or PNG.
        </p>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-6">
          {/* Preview */}
          {logoUrl ? (
            <div className="relative group">
              <div className="w-24 h-24 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center p-2">
                <img
                  src={logoUrl}
                  alt="Company logo"
                  className="max-w-full max-h-full object-contain"
                />
              </div>
              <button
                onClick={removeLogo}
                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-md flex items-center justify-center"
                title="Remove logo"
              >
                ✕
              </button>
            </div>
          ) : null}

          {/* Upload zone */}
          <div
            className={`upload-zone flex-1 ${dragOverLogo ? "drag-over" : ""}`}
            onClick={() => logoInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverLogo(true);
            }}
            onDragLeave={() => setDragOverLogo(false)}
            onDrop={(e) => handleDrop(e, handleLogoFile, setDragOverLogo)}
          >
            <input
              ref={logoInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLogoFile(f);
                e.target.value = "";
              }}
            />
            <div className="text-gray-400 mb-2">
              <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-600">
              Click or drag & drop to upload logo
            </p>
            <p className="text-xs text-gray-400 mt-1">JPG, PNG up to 2 MB</p>
          </div>
        </div>
      </section>

      {/* ── Theme Presets ───────────────────────────────────────────────── */}
      <section className="card p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-1">Theme</h2>
        <p className="text-sm text-gray-500 mb-5">
          Choose an industry colour scheme or extract a custom palette from an image.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          {THEMES.map((t) => {
            const selected = !isCustom && activeTheme === t.key;
            return (
              <button
                key={t.key}
                onClick={() => selectPreset(t.key)}
                className={`relative text-left rounded-xl border-2 p-4 transition-all duration-200 ${
                  selected
                    ? "border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)]/20 shadow-md"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                {selected && (
                  <span className="absolute top-2.5 right-2.5 badge badge-accent">
                    Active
                  </span>
                )}
                <div className="flex gap-1.5 mb-3">
                  <div
                    className="theme-swatch"
                    style={{ backgroundColor: t.colors.sidebarBg }}
                  />
                  <div
                    className="theme-swatch"
                    style={{ backgroundColor: t.colors.primary }}
                  />
                  <div
                    className="theme-swatch"
                    style={{ backgroundColor: t.colors.accent }}
                  />
                  <div
                    className="theme-swatch"
                    style={{ backgroundColor: t.colors.primaryLight }}
                  />
                </div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-gray-500">{t.industry}</p>
              </button>
            );
          })}

          {/* Custom palette card */}
          <button
            onClick={() => themeInputRef.current?.click()}
            className={`relative text-left rounded-xl border-2 p-4 transition-all duration-200 ${
              isCustom
                ? "border-[var(--theme-accent)] ring-2 ring-[var(--theme-accent)]/20 shadow-md"
                : "border-dashed border-gray-300 hover:border-gray-400 hover:shadow-sm"
            }`}
          >
            {isCustom && (
              <span className="absolute top-2.5 right-2.5 badge badge-accent">
                Active
              </span>
            )}
            {isCustom && customColors ? (
              <>
                <div className="flex gap-1.5 mb-3">
                  <div className="theme-swatch" style={{ backgroundColor: customColors.sidebarBg }} />
                  <div className="theme-swatch" style={{ backgroundColor: customColors.primary }} />
                  <div className="theme-swatch" style={{ backgroundColor: customColors.accent }} />
                  <div className="theme-swatch" style={{ backgroundColor: customColors.primaryLight }} />
                </div>
                <p className="text-sm font-semibold">Custom Palette</p>
                <p className="text-xs text-gray-500">Extracted from image</p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center mb-3 h-8 text-gray-400">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-600">Custom from Image</p>
                <p className="text-xs text-gray-400">Upload JPG / PNG</p>
              </>
            )}
            <input
              ref={themeInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleThemeImageFile(f);
                e.target.value = "";
              }}
            />
          </button>
        </div>

        {extracting && (
          <p className="mt-4 text-sm text-gray-500 animate-pulse">
            Extracting colours from image…
          </p>
        )}

        {extractedPreview && isCustom && (
          <div className="mt-5 flex items-center gap-4 rounded-xl bg-gray-50 p-4 border border-gray-100">
            <img
              src={extractedPreview}
              alt="Source"
              className="w-16 h-16 rounded-lg object-cover border border-gray-200"
            />
            <div>
              <p className="text-sm font-medium">Palette extracted</p>
              <p className="text-xs text-gray-500">
                Colours were sampled from this image and applied as your custom theme.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── Company & Tax details ─────────────────────────────────────── */}
      {companyLoaded && (
        <section className="card p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-1">Company &amp; Tax details</h2>
          <p className="text-sm text-gray-500 mb-5">
            Universal header &amp; footer details printed on quotations, invoices and purchase orders.
          </p>
          <form onSubmit={saveCompany} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Legal name"><input className="field w-full" value={company.legalName} onChange={(e) => setCompany({ ...company, legalName: e.target.value })} /></Field>
              <Field label="GSTIN"><input className="field w-full" value={company.gstin} onChange={(e) => setCompany({ ...company, gstin: e.target.value })} /></Field>
              <Field label="PAN"><input className="field w-full" value={company.pan} onChange={(e) => setCompany({ ...company, pan: e.target.value })} /></Field>
            </div>
            <Field label="Address"><textarea className="field w-full" rows={2} value={company.address} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="City"><input className="field w-full" value={company.city} onChange={(e) => setCompany({ ...company, city: e.target.value })} /></Field>
              <Field label="State"><input className="field w-full" value={company.state} onChange={(e) => setCompany({ ...company, state: e.target.value })} /></Field>
              <Field label="Pin code"><input className="field w-full" value={company.pinCode} onChange={(e) => setCompany({ ...company, pinCode: e.target.value })} /></Field>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-2">Contact details (printed in the document header &amp; footer)</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Email"><input type="email" className="field w-full" value={company.email} onChange={(e) => setCompany({ ...company, email: e.target.value })} /></Field>
                <Field label="Website"><input className="field w-full" placeholder="https://www.example.com" value={company.website} onChange={(e) => setCompany({ ...company, website: e.target.value })} /></Field>
                <Field label="Phone"><input className="field w-full" value={company.phone} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></Field>
              </div>
              <div className="mt-3">
                <Field label="Footer note (extra details printed at the bottom of every document)">
                  <textarea className="field w-full" rows={2} placeholder="e.g. All amounts in INR. Goods once sold will not be taken back." value={company.documentFooterNote} onChange={(e) => setCompany({ ...company, documentFooterNote: e.target.value })} />
                </Field>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Bank name"><input className="field w-full" value={company.bankName} onChange={(e) => setCompany({ ...company, bankName: e.target.value })} /></Field>
              <Field label="Account number"><input className="field w-full" value={company.bankAccountNumber} onChange={(e) => setCompany({ ...company, bankAccountNumber: e.target.value })} /></Field>
              <Field label="IFSC"><input className="field w-full" value={company.bankIfsc} onChange={(e) => setCompany({ ...company, bankIfsc: e.target.value })} /></Field>
              <Field label="Bank branch"><input className="field w-full" value={company.bankBranch} onChange={(e) => setCompany({ ...company, bankBranch: e.target.value })} /></Field>
              <Field label="Default tax rate %"><input type="number" step="0.01" className="field w-full" value={company.defaultTaxRatePct} onChange={(e) => setCompany({ ...company, defaultTaxRatePct: e.target.value })} /></Field>
            </div>
            <Field label="Invoice terms"><textarea className="field w-full" rows={2} value={company.invoiceTerms} onChange={(e) => setCompany({ ...company, invoiceTerms: e.target.value })} /></Field>
            <Field label="Quotation terms"><textarea className="field w-full" rows={2} value={company.quotationTerms} onChange={(e) => setCompany({ ...company, quotationTerms: e.target.value })} /></Field>
            <Field label="Purchase order terms"><textarea className="field w-full" rows={2} value={company.purchaseOrderTerms} onChange={(e) => setCompany({ ...company, purchaseOrderTerms: e.target.value })} /></Field>

            <div className="pt-2 border-t border-gray-100">
              <label className="block text-xs font-medium text-gray-500 mb-2">Authorised signatory</label>
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                {signatoryDataUrl ? (
                  <div className="relative group">
                    <div className="w-24 h-24 rounded-xl border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center p-2">
                      <img src={signatoryDataUrl} alt="Authorised signatory" className="max-w-full max-h-full object-contain" />
                    </div>
                    <button
                      type="button"
                      onClick={removeSignatoryImage}
                      className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-md flex items-center justify-center"
                      title="Remove signatory picture"
                    >
                      ✕
                    </button>
                  </div>
                ) : null}
                <div
                  className={`upload-zone flex-1 ${dragOverSignatory ? "drag-over" : ""}`}
                  onClick={() => signatoryInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOverSignatory(true); }}
                  onDragLeave={() => setDragOverSignatory(false)}
                  onDrop={(e) => handleDrop(e, handleSignatoryFile, setDragOverSignatory)}
                >
                  <input
                    ref={signatoryInputRef}
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleSignatoryFile(f);
                      e.target.value = "";
                    }}
                  />
                  <p className="text-sm font-medium text-gray-600">Click or drag &amp; drop to upload signature</p>
                  <p className="text-xs text-gray-400 mt-1">JPG, PNG up to 2 MB — printed on quotations, invoices and purchase orders</p>
                </div>
              </div>
              <Field label="Signatory name">
                <input className="field w-full mt-2" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} placeholder="e.g. R. Kumar, Director" />
              </Field>
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={companySaving} className="btn-primary px-4 py-2 text-sm">{companySaving ? "Saving…" : "Save company details"}</button>
            </div>
          </form>
        </section>
      )}

      {/* ── Live Preview ────────────────────────────────────────────────── */}
      <section className="card p-4 sm:p-6">
        <h2 className="text-base sm:text-lg font-semibold mb-4">Live Preview</h2>
        <div className="flex flex-col sm:flex-row gap-4">
          <div
            className="w-full sm:w-48 rounded-xl p-4 space-y-2"
            style={{ backgroundColor: "var(--theme-sidebar-bg)", color: "var(--theme-sidebar-text)" }}
          >
            {logoUrl && (
              <div className="mb-3 flex justify-center">
                <img src={logoUrl} alt="Logo" className="h-8 object-contain opacity-90" />
              </div>
            )}
            <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--theme-sidebar-text-muted)" }}>
              Menu
            </div>
            <div className="rounded-md px-2 py-1.5 text-sm" style={{ backgroundColor: "var(--theme-sidebar-active)", color: "var(--theme-sidebar-text)" }}>
              Dashboard
            </div>
            <div className="rounded-md px-2 py-1.5 text-sm" style={{ color: "var(--theme-sidebar-text-muted)" }}>
              Orders
            </div>
            <div className="rounded-md px-2 py-1.5 text-sm" style={{ color: "var(--theme-sidebar-text-muted)" }}>
              Sites
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-primary-light)" }}>
              <p className="text-sm font-medium" style={{ color: "var(--theme-primary)" }}>
                Primary surface
              </p>
            </div>
            <div className="flex gap-3">
              <button
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--theme-primary)" }}
              >
                Primary
              </button>
              <button
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--theme-accent)" }}
              >
                Accent
              </button>
            </div>
            <div className="rounded-lg p-3" style={{ backgroundColor: "var(--theme-accent-light)" }}>
              <p className="text-sm" style={{ color: "var(--theme-accent)" }}>
                Accent surface
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
