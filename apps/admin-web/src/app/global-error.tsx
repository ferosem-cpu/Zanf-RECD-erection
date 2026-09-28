"use client";

/** Last-resort boundary for errors thrown by the root layout itself (AuthProvider etc.).
 * Must render its own <html>/<body> because it replaces the root layout. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f9fafb", color: "#111827" }}>
        <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, textAlign: "center" }} role="alert">
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Zan-APP couldn&apos;t load</h2>
          <p style={{ fontSize: 14, color: "#4b5563", marginTop: 8 }}>Something went wrong while starting the app. Please reload the page.</p>
          {error?.digest && <p style={{ fontSize: 12, color: "#9ca3af", fontFamily: "monospace" }}>Ref: {error.digest}</p>}
          <div style={{ marginTop: 20, display: "flex", gap: 12, justifyContent: "center" }}>
            <button type="button" onClick={() => reset()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
              Try again
            </button>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#1f4e79", color: "#fff", cursor: "pointer" }}>
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
