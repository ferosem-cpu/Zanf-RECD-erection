/** Orchestrates the "Extract with AI" step for Vendor Invoices: sends the uploaded scan/photo
 * to the configured LLM providers (tried in priority order, same fallback pattern as the chat
 * agent), asks for a strict JSON extraction, and fuzzy-matches the guessed supplier name
 * against existing Supplier/Vendor rows. Never writes anything - the caller (POST
 * /bills/extract) only returns this as a pre-fill; the human always reviews before saving.
 */
import { prisma } from "../lib/prisma";
import { createAdapterForRow, loadActiveProvidersInOrder } from "./providers/factory";
import { ProviderCallError } from "./providers/types";

export interface ExtractedLineItem {
  description: string;
  hsnCode?: string;
  quantity?: number;
  unitPrice?: number;
  taxRatePct?: number;
}

export interface ExtractedBill {
  supplierNameGuess?: string;
  gstinGuess?: string;
  panGuess?: string;
  billNumber?: string;
  billDate?: string; // ISO date, best effort
  dueDate?: string;
  sourceTypeGuess?: "printed" | "handwritten" | "digital";
  /** "low" | "medium" | "high" - the model's own confidence, mainly meaningful for
   * handwritten sources where OCR-style misreads are common. */
  confidence?: string;
  lineItems: ExtractedLineItem[];
  subtotal?: number;
  taxAmount?: number;
  total?: number;
  notes?: string;
}

export interface SupplierCandidate {
  id: string;
  name: string;
  gstin?: string | null;
  source: "supplier" | "vendor";
  score: number;
}

export class ExtractionUnavailableError extends Error {}

const INSTRUCTIONS = `You are extracting structured data from a photo or scan of a vendor invoice / supplier bill for an Indian company's accounting system. Read the document carefully, including any handwritten text, and respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "supplierNameGuess": string | null,
  "gstinGuess": string | null,
  "panGuess": string | null,  // PAN, if separately printed/written on the invoice (not just derivable from the GSTIN)
  "billNumber": string | null,
  "billDate": string | null,   // ISO 8601 date (YYYY-MM-DD), your best reading of the invoice date
  "dueDate": string | null,    // ISO 8601 date, if a due/payment date is printed
  "sourceTypeGuess": "printed" | "handwritten" | "digital",
  "confidence": "low" | "medium" | "high",  // your confidence in this reading overall
  "lineItems": [
    { "description": string, "hsnCode": string | null, "quantity": number | null, "unitPrice": number | null, "taxRatePct": number | null }
  ],
  "subtotal": number | null,
  "taxAmount": number | null,
  "total": number | null,
  "notes": string | null   // anything unclear, illegible, or worth a human's attention
}

If the document is handwritten or partly illegible, still do your best and set "confidence" accordingly rather than leaving everything null. If you cannot make out a specific field, use null for it - never invent a value you can't actually read.`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : trimmed;
}

export async function extractBillFromFile(fileBase64: string, mimeType: string): Promise<ExtractedBill> {
  const providers = await loadActiveProvidersInOrder();
  if (providers.length === 0) {
    throw new ExtractionUnavailableError(
      "No AI provider is configured yet. Add one under Settings > Agent providers, or enter this bill's details manually.",
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
        supplierNameGuess: obj.supplierNameGuess ? String(obj.supplierNameGuess) : undefined,
        gstinGuess: obj.gstinGuess ? String(obj.gstinGuess) : undefined,
        panGuess: obj.panGuess ? String(obj.panGuess) : undefined,
        billNumber: obj.billNumber ? String(obj.billNumber) : undefined,
        billDate: obj.billDate ? String(obj.billDate) : undefined,
        dueDate: obj.dueDate ? String(obj.dueDate) : undefined,
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

/** Very small fuzzy match: normalizes whitespace/case and scores by shared word overlap plus
 * substring containment. Good enough to surface a short candidate list for a human to
 * confirm - never auto-selects a supplier on its own. */
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

export async function findSupplierCandidates(nameGuess: string | undefined, limit = 5): Promise<SupplierCandidate[]> {
  if (!nameGuess?.trim()) return [];
  const [suppliers, vendors] = await Promise.all([
    prisma.supplier.findMany({ where: { isActive: true }, select: { id: true, name: true, gstin: true } }),
    prisma.vendor.findMany({ where: { status: "approved" }, select: { id: true, name: true } }),
  ]);
  const candidates: SupplierCandidate[] = [
    ...suppliers.map((s) => ({ id: s.id, name: s.name, gstin: s.gstin, source: "supplier" as const, score: similarity(nameGuess, s.name) })),
    ...vendors.map((v) => ({ id: v.id, name: v.name, source: "vendor" as const, score: similarity(nameGuess, v.name) })),
  ];
  return candidates
    .filter((c) => c.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
