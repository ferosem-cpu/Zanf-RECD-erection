import type { AgentTool } from "./types";
import { searchDriveDocuments, listDriveDocuments, getDriveDocumentContent } from "./driveSearch";
import { ExtractionError } from "../../lib/docExtract";

export const driveTools: AgentTool[] = [
  {
    name: "search_documents",
    description:
      "Full-text search over documents in the company's shared document folder (vendor files, " +
      "quotes, attachments, etc). Searches file content, not just names. Returns matches with " +
      "fileId, name, and a link - use get_document_content on a fileId to read the actual text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms to look for in document content." },
      },
      required: ["query"],
    },
    handler: async (input) => {
      const query = String(input.query ?? "");
      return searchDriveDocuments(query);
    },
  },
  {
    name: "list_documents",
    description:
      "Lists all documents in the company's shared document folder, most recently modified first. " +
      "Use this to browse what's available when the user isn't searching for something specific.",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      return listDriveDocuments();
    },
  },
  {
    name: "get_document_content",
    description:
      "Reads and extracts the text content of one specific document, given the fileId returned by " +
      "search_documents or list_documents. Supports PDF, DOCX, and plain text/CSV files. Scanned " +
      "or image-only PDFs cannot be read (no OCR support) and will return an error.",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "The Drive fileId of the document to read." },
      },
      required: ["fileId"],
    },
    handler: async (input) => {
      const fileId = String(input.fileId ?? "");
      try {
        return await getDriveDocumentContent(fileId);
      } catch (err) {
        if (err instanceof ExtractionError) {
          return { error: err.message };
        }
        throw err;
      }
    },
  },
];
