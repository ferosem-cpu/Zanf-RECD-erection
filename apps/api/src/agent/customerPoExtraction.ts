/** Orchestrates the "Extract with AI" step for Customer Purchase Orders - a PO a customer
 * sends TO Zan-F (the mirror of billExtraction.ts, which reads a supplier's bill TO us).
 * Same pattern: try configured LLM providers in priority order, ask for a strict JSON
 * extraction, fuzzy-match the guessed customer name against existing Customer rows. Never
 * writes anything - the caller (POST /customer-purchase-orders/extract) only returns this as
 * a pre-fill; the human always reviews before saving.
 */
import { prisma } from "../lib/prisma";
import { createAdapterForRow, loadActiveProvidersInOrder } from "./providers/factory";
import { ProviderCallError } from "./providers/types";
import { ExtractionUnavailableError } from "./billExtraction";

export interface ExtractedCustomerPoLineItem {
  description: string;
  hsnCode?: string;
  quantity?: number;
  unitPrice?: number;
  taxRatePct?: number;
}

export interface ExtractedCustomerPo {
  customerNameGuess?: string;
  gstinGuess?: string;
  poNumber?: string;
  poDate?: string; // ISO date, best effort
  placeOfSupply?: string;
  workLocation?: string;
  scopeOfWork?: string;
  paymentDueDate?: string;
  customerRefCode?: string;
  sourceTypeGuess?: "printed" | "handwritten" | "digital";
  confidence?: string;
  lineItems: ExtractedCustomerPoLineItem[];
  subtotal?: number;
  taxAmount?: number;
  total?: number;
  notes?: string;
}

export interface CustomerCandidate {
  id: string;
  name: string;
  gstin?: string | null;
  score: number;
}

const INSTRUCTIONS = `You are extracting structured data from a photo, scan, or PDF of a purchase order (PO) that a CUSTOMER has sent to an Indian company ("us", the vendor/contractor named as "Vendor Details" or similar on the document - do NOT extract our own company as the customer). Read the document carefully, including any handwritten text, and respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "customerNameGuess": string | null,  // the company that ISSUED this PO to us (appears at the top / as the letterhead, NOT the "Vendor"/"Vendor Details" section)
  "gstinGuess": string | null,          // the customer's own GSTIN, not ours
  "poNumber": string | null,
  "poDate": string | null,      // ISO 8601 date (YYYY-MM-DD)
  "placeOfSupply": string | null,
  "workLocation": string | null,   // site/work location as printed, e.g. "AAI-TRZ" or a site name/code
  "scopeOfWork": string | null,    // short description of the work/scope
  "paymentDueDate": string | null, // ISO 8601 date, if a "payment by" / due date is printed
  "customerRefCode": string | null, // any vendor code / reference code the customer assigned to us, if printed
  "sourceTypeGuess": "printed" | "handwritten" | "digital",
  "confidence": "low" | "medium" | "high",
  "lineItems": [
    { "description": string, "hsnCode": string | null, "quantity": number | null, "unitPrice": number | null, "taxRatePct": number | null }
  ],
  "subtotal": number | null,
  "taxAmount": number | null,
  "total": number | null,
  "notes": string | null
}

If the document is handwritten or partly illegible, still do your best and set "confidence" accordingly rather than leaving everything null. If you cannot make out a specific field, use null for it - never invent a value you can't actually read.`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : trimmed;
}

export async function extractCustomerPoFromFile(fileBase64: string, mimeType: string): Promise<ExtractedCustomerPo> {
  const providers = await loadActiveProvidersInOrder();
  if (providers.length === 0) {
    throw new ExtractionUnavailableError(
      "No AI provider is configured yet. Add one under Settings > Agent providers, or enter this PO's details manually.",
    );
  }

  const failures: string[] = [];
  for (const providerRow of providers) {
    const adapter = createAdapterForRow(providerRow);
    if (!adapter.extractDocument) {
      failures.push(`${providerRow.name}: does not support document extraction`);
      continue;
    }
    try {
      const raw = await adapter.extractDocument({ instructions: INSTRUCTIONS, fileBase64, mimeType });
      const jsonText = stripJsonFences(raw);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        failures.push(`${providerRow.name}: response wasn't valid JSON`);
        continue;
      }
      const obj = parsed as Record<string, unknown>;
      const lineItems = Array.isArray(obj.lineItems)
        ? (obj.lineItems as Record<string, unknown>[]).map((li) => ({
            description: String(li.description ?? "").trim(),
            hsnCode: li.hsnCode ? String(li.hsnCode) : undefined,
            quantity: typeof li.quantity === "number" ? li.quantity : undefined,
            unitPrice: typeof li.unitPrice === "number" ? li.unitPrice : undefined,
            taxRatePct: typeof li.taxRatePct === "number" ? li.taxRatePct : undefined,
          })).filter((li) => li.description)
        : [];
      return {
        customerNameGuess: obj.customerNameGuess ? String(obj.customerNameGuess) : undefined,
        gstinGuess: obj.gstinGuess ? String(obj.gstinGuess) : undefined,
        poNumber: obj.poNumber ? String(obj.poNumber) : undefined,
        poDate: obj.poDate ? String(obj.poDate) : undefined,
        placeOfSupply: obj.placeOfSupply ? String(obj.placeOfSupply) : undefined,
        workLocation: obj.workLocation ? String(obj.workLocation) : undefined,
        scopeOfWork: obj.scopeOfWork ? String(obj.scopeOfWork) : undefined,
        paymentDueDate: obj.paymentDueDate ? String(obj.paymentDueDate) : undefined,
        customerRefCode: obj.customerRefCode ? String(obj.customerRefCode) : undefined,
        sourceTypeGuess: obj.sourceTypeGuess === "handwritten" || obj.sourceTypeGuess === "digital" ? obj.sourceTypeGuess : "printed",
        confidence: obj.confidence ? String(obj.confidence) : undefined,
        lineItems,
        subtotal: typeof obj.subtotal === "number" ? obj.subtotal : undefined,
        taxAmount: typeof obj.taxAmount === "number" ? obj.taxAmount : undefined,
        total: typeof obj.total === "number" ? obj.total : undefined,
        notes: obj.notes ? String(obj.notes) : undefined,
      };
    } catch (err) {
      const message = err instanceof ProviderCallError ? err.message : (err as Error).message;
      failures.push(`${providerRow.name}: ${message}`);
    }
  }
  throw new ExtractionUnavailableError(`AI extraction failed for every configured provider:\n${failures.join("\n")}`);
}

/** Same small fuzzy match as findSupplierCandidates in billExtraction.ts - word overlap plus
 * substring containment. Never auto-selects a customer; only surfaces candidates for a human
 * to confirm. */
function similarity(a: string, b: string): number {
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const wa = new Set(na.split(/\s+/).filter(Boolean));
  const wb = new Set(nb.split(/\s+/).filter(Boolean));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : shared / union;
}

export async function findCustomerCandidates(nameGuess: string | undefined, limit = 5): Promise<CustomerCandidate[]> {
  if (!nameGuess?.trim()) return [];
  const customers = await prisma.customer.findMany({ select: { id: true, name: true, gstin: true } });
  return customers
    .map((c) => ({ id: c.id, name: c.name, gstin: c.gstin, score: similarity(nameGuess, c.name) }))
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
