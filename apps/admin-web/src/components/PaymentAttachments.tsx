"use client";

import { api } from "@/lib/apiClient";
import { captureFile } from "@/lib/fileCapture";

export const MAX_ATTACHMENTS = 5;

export const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function addFiles(current: File[], picked: FileList | null, keep: number): File[] {
  const next = [...current, ...Array.from(picked ?? [])];
  return next.slice(0, Math.max(0, MAX_ATTACHMENTS - keep));
}

/** Uploads files one request each (keeps every body under the hosting size limit). Returns the
 * names that failed, so the payment itself is never lost because one file was rejected. */
export async function uploadAttachments(paymentId: string, files: File[]): Promise<string[]> {
  const failed: string[] = [];
  for (const file of files) {
    try {
      const captured = await captureFile(file);
      await api(`/bills/payments/${paymentId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ attachments: [{ fileName: file.name, mimeType: captured.mimeType, dataUrl: captured.dataUrl }] }),
      });
    } catch (err) {
      failed.push(`${file.name} (${err instanceof Error ? err.message : "upload failed"})`);
    }
  }
  return failed;
}

/** Picked-but-not-yet-uploaded files, with a remove button each. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-700">
          <span className="truncate">{f.name} · {fileSize(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)} className="text-gray-400 hover:text-gray-600" aria-label={`Remove ${f.name}`}>✕</button>
        </li>
      ))}
    </ul>
  );
}

/** File input + pending list for a new payment's supporting documents. */
export function AttachmentPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">Attachments (optional - bank advice, cheque, TDS certificate; images or PDF, max {MAX_ATTACHMENTS})</label>
      <input
        type="file"
        multiple
        accept="image/*,application/pdf"
        className="block w-full text-sm"
        disabled={files.length >= MAX_ATTACHMENTS}
        onChange={(e) => { onChange(addFiles(files, e.target.files, 0)); e.target.value = ""; }}
      />
      <PendingFiles files={files} onRemove={(i) => onChange(files.filter((_, j) => j !== i))} />
    </div>
  );
}
