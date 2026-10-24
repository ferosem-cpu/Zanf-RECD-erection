/** Which site an invoice is for.
 *
 * Why: get_receivables / search_invoices returned no site at all, so when asked for "the site
 * name from each invoice" the model invented one and repeated it on every row (BPCL, then VRL,
 * for all invoices). An invoice reaches its site through Invoice.order -> Order.site; invoices
 * the assistant created without an order link only carry the site in their line descriptions
 * ("<service> - <site>, <area>, <city>"), so that is the fallback.
 */
export const invoiceSiteSelect = {
  order: { select: { orderNumber: true, site: { select: { id: true, companyName: true, address: true } } } },
  lineItems: { select: { description: true }, orderBy: { sortOrder: "asc" as const }, take: 1 },
} as const;

type InvoiceSiteSource = {
  order?: { orderNumber: string; site: { id: string; companyName: string | null; address: string | null } | null } | null;
  lineItems?: { description: string }[];
};

/** "Dismantling & Mechanical Fabrication - BOSTIK, Bommasandra, Bangalore (380 KVA)" -> "BOSTIK, Bommasandra, Bangalore" */
export function siteFromLineDescription(description: string | undefined): string | null {
  if (!description) return null;
  const parts = description.split(/\s+[–—-]\s+/);
  if (parts.length < 2) return null;
  const site = parts.slice(1).join(" - ").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return site || null;
}

export function invoiceSiteInfo(inv: InvoiceSourceLike) {
  const site = inv.order?.site;
  if (site) {
    return {
      orderNumber: inv.order?.orderNumber ?? null,
      site: { id: site.id, siteName: site.companyName ?? null, address: site.address ?? null },
      siteSource: "order" as const,
    };
  }
  const fromLine = siteFromLineDescription(inv.lineItems?.[0]?.description);
  if (fromLine) {
    return { orderNumber: inv.order?.orderNumber ?? null, site: null, siteFromLineDescription: fromLine, siteSource: "line_description" as const };
  }
  return { orderNumber: inv.order?.orderNumber ?? null, site: null, siteSource: null };
}

type InvoiceSourceLike = InvoiceSiteSource;

export const INVOICE_SITE_RULE =
  "Each invoice row carries its own site: site {id, siteName, address} when the invoice is linked to an order " +
  "(siteSource 'order'), or siteFromLineDescription (the site text taken from the invoice's own line items) when it " +
  "is not. When asked for the site of each invoice, copy the value from THAT row - never reuse one row's site for " +
  "another, and say 'no site on this invoice' when siteSource is null.";
