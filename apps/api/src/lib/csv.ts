// Tiny dependency-free server-side CSV builder — mirrors the client-side
// apps/admin-web/src/lib/csvExport.ts escaping/BOM convention exactly, so a
// CSV streamed from the API opens in Excel the same way a client-built one does.

function escapeCsvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  // Leading BOM so Excel opens UTF-8 (₹, GSTIN text, etc.) correctly.
  return "﻿" + lines.join("\r\n");
}
