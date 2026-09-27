/** Generic one-shot document extraction for the Agent chat's attachment feature: unlike
 * billExtraction.ts (which asks for a strict vendor-invoice shape), this asks the model to
 * read WHATEVER document was attached - invoice, ID card, delivery note, handwritten note,
 * anything - and return a loose set of fields plus the raw text it could make out. The
 * chat route folds the result into the user's message text (see agentConversations.ts) so
 * the normal text-only tool-calling loop can act on it (e.g. propose create_vendor_invoice
 * or create_expense) without any change to the multi-turn message format. Never writes
 * anything itself - purely a read.
 */
import { loadActiveProvidersInOrder, createAdapterForRow } from "./providers/factory";
import { formatProviderFailures, providersToAttempt, recordProviderFailure, simpleFailure, type ProviderFailure } from "./providers/providerHealth";
import { ExtractionUnavailableError } from "./billExtraction";

export interface GenericExtraction {
  documentType?: string;
  summary?: string;
  fields: Record<string, string>;
  rawText?: string;
}

const INSTRUCTIONS = `You are extracting information from a photo, scan, or PDF of a document \
attached inside a business chat assistant. The document could be anything - an invoice, a \
purchase order, an ID/registration document, a handwritten note, a delivery challan, etc. \
Read it carefully, including any handwritten text, and respond with ONLY a single JSON object \
(no markdown fences, no commentary) matching exactly this shape:

{
  "documentType": string | null,   // your best guess at what kind of document this is, e.g. "vendor invoice", "purchase order", "handwritten note"
  "summary": string | null,        // one or two sentences describing what the document is and its key point
  "fields": { [key: string]: string },  // every distinct labeled/identifiable field you can read, as flat key-value pairs - e.g. supplierName, gstin, pan, invoiceNumber, invoiceDate, totalAmount, customerName, address, phone, email - use whatever keys make sense for THIS document, do not force it into a fixed schema
  "rawText": string | null         // all the readable text on the document, transcribed as plainly as possible, for anything not captured as a structured field
}

If the document is handwritten or partly illegible, still do your best rather than leaving \
everything blank. Never invent a value you can't actually read - omit that field instead.`;

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : trimmed;
}

export async function extractGenericDocument(fileBase64: string, mimeType: string): Promise<GenericExtraction> {
  const providers = await loadActiveProvidersInOrder();
  if (providers.length === 0) {
    throw new ExtractionUnavailableError(
      "No AI provider is configured yet, so I can't read attached documents right now. Add one under Settings > Agent providers.",
    );
  }

  const failures: ProviderFailure[] = [];
  const primaryId = providers[0]?.id;
  const { attempt, skipped } = providersToAttempt(providers);
  for (const providerRow of attempt) {
    const primary = providerRow.id === primaryId;
    try {
      // Inside the try so a broken fallback row can't mask the primary provider's error.
      const adapter = createAdapterForRow(providerRow);
      if (!adapter.extractDocument) {
        failures.push(simpleFailure(providerRow, "does not support document extraction", primary, "document-extraction"));
        continue;
      }
      const raw = await adapter.extractDocument({ instructions: INSTRUCTIONS, fileBase64, mimeType });
      const jsonText = stripJsonFences(raw);
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        failures.push(simpleFailure(providerRow, "response wasn't valid JSON", primary, "document-extraction"));
        continue;
      }
      const obj = parsed as Record<string, unknown>;
      const fields: Record<string, string> = {};
      if (obj.fields && typeof obj.fields === "object") {
        for (const [k, v] of Object.entries(obj.fields as Record<string, unknown>)) {
          if (v !== null && v !== undefined && String(v).trim()) fields[k] = String(v);
        }
      }
      return {
        documentType: obj.documentType ? String(obj.documentType) : undefined,
        summary: obj.summary ? String(obj.summary) : undefined,
        fields,
        rawText: obj.rawText ? String(obj.rawText) : undefined,
      };
    } catch (err) {
      failures.push(recordProviderFailure(providerRow, err, "document-extraction", { primary }));
    }
  }
  throw new ExtractionUnavailableError(`AI extraction failed for every configured provider:\n${formatProviderFailures(failures, skipped)}`);
}
