import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { extractText, pdfWorkerUrl } from "../src/lib/docExtract";
import { getDriveDocumentContent, resetFolderTreeCache, type DriveLike } from "../src/agent/tools/driveSearch";

/** Minimal one-page text PDF (Helvetica, correct xref offsets) - a fixture with no network. */
function makePdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("the pdf.js worker resolves to a real file via the nft-traceable path", () => {
  const url = pdfWorkerUrl();
  assert.match(url, /^file:.*pdf-parse\/dist\/pdf-parse\/cjs\/pdf\.worker\.mjs$/);
  assert.ok(fs.existsSync(fileURLToPath(url)));
});

test("extractText reads the text layer of a PDF (warranty clause)", async () => {
  const text = await extractText(makePdf("Warranty: 24 months from commissioning"), "application/pdf");
  assert.match(text, /Warranty: 24 months from commissioning/);
});

test("get_document_content path: a Drive PDF inside the folder is downloaded and its text returned", async () => {
  resetFolderTreeCache();
  const pdf = makePdf("Warranty clause 7.2");
  const files = [
    { id: "root", name: "ZanF_DropBox", mimeType: "application/vnd.google-apps.folder", parents: ["myDrive"] },
    { id: "q1", name: "AgsarPaint_Quote_TTCRN v1.2.pdf", mimeType: "application/pdf", parents: ["root"] },
  ];
  const drive: DriveLike = {
    files: {
      async list(params) {
        const q = String(params.q);
        // Only the folder-tree query runs: no subfolders under root.
        return { data: { files: q.includes("mimeType = 'application/vnd.google-apps.folder'") ? [] : files } };
      },
      async get(params) {
        if (params.alt === "media") return { data: pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) };
        return { data: files.find((f) => f.id === params.fileId) };
      },
      async export() {
        throw new Error("PDFs are downloaded, never exported/converted");
      },
    },
  };
  const out = await getDriveDocumentContent("q1", { drive, rootId: "root" });
  assert.equal(out.name, "AgsarPaint_Quote_TTCRN v1.2.pdf");
  assert.match(out.text, /Warranty clause 7\.2/);
});
