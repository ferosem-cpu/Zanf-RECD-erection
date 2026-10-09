import type { AgentTool, AgentAuthContext } from "./types";
import { searchDriveDocuments, listDriveDocuments, getDriveDocumentByRef } from "./driveSearch";
import { ExtractionError } from "../../lib/docExtract";

function forbidden() {
  return { error: "You don't have permission to access shared company documents." };
}

/** The shared Drive folder holds internal company material (vendor files, quotes, internal
 * attachments) with no per-customer partitioning - there's no way to scope it to "documents
 * about this customer", so customers get no access at all rather than a false sense of scoping.
 * customerId is only ever set on the Customer role's auth context (see middleware/auth.ts). */
function isCustomer(auth: AgentAuthContext): boolean {
  return !!auth.customerId;
}

export const driveTools: AgentTool[] = [
  {
    name: "search_documents",
    description:
      "Search documents in the company's shared document folder (ZanF_DropBox) and ALL its " +
      "subfolders (vendor files, quotes, proforma/tax invoices, PCR reports, attachments). Matches " +
      "the full file name (with or without extension), the phrase or every word in file/folder names and " +
      "indexed file content, then names containing ANY of the words. To find a known file, pass its name " +
      "(e.g. 'AgsarPaint_Quote_TTCRN v1.2.pdf') - don't add topic words like 'warranty' to the query. Returns up to 25 " +
      "matches (exact/every-word name matches first) with fileId, name, folderPath, webViewLink and totalMatches - use " +
      "get_document_content on a fileId to read the text. Try a shorter or alternative term (e.g. 'PI', " +
      "'proforma', a customer or site name) before saying nothing exists; files outside the shared " +
      "folder are not visible. App backups (names starting zanapp-backup-) and JSON files are never searched, listed or read.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for in file names and content (e.g. 'proforma invoice', 'PCR')." },
      },
      required: ["query"],
    },
    handler: async (input, auth) => {
      if (isCustomer(auth)) return forbidden();
      const query = String(input.query ?? "");
      return searchDriveDocuments(query);
    },
  },
  {
    name: "list_documents",
    description:
      "Lists the 50 most recently modified documents anywhere in the company's shared document " +
      "folder and its subfolders, with folderPath and webViewLink. " +
      "Use this to browse what's available when the user isn't searching for something specific.",
    inputSchema: { type: "object", properties: {} },
    handler: async (_input, auth) => {
      if (isCustomer(auth)) return forbidden();
      return listDriveDocuments();
    },
  },
  {
    name: "get_document_content",
    description:
      "Reads and extracts the text content of one specific document, given the fileId returned by " +
      "search_documents or list_documents, or the file's exact name (e.g. 'AgsarPaint_Quote_TTCRN v1.2.pdf'). Supports PDF (its text layer), DOCX, and plain text/CSV files. " +
      "Only a scanned/image-only PDF with no text layer cannot be read (no OCR); any other error is a read " +
      "failure - quote it, don't call the file 'scanned' or 'without OCR text'.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "The Drive fileId of the document to read, or its exact file name." },
      },
      required: ["fileId"],
    },
    handler: async (input, auth) => {
      if (isCustomer(auth)) return forbidden();
      const fileId = String(input.fileId ?? "");
      try {
        return await getDriveDocumentByRef(fileId);
      } catch (err) {
        if (err instanceof ExtractionError) {
          return { error: err.message };
        }
        throw err;
      }
    },
  },
];
