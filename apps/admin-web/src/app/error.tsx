"use client";

import { useEffect } from "react";

/** Route-level error boundary. Before this existed an exception while rendering a page (or a
 * failed chunk load right after a new deployment) left the user on Next's bare
 * "Application error" screen, and only a hard refresh recovered. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const isChunkError = /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(
    `${error?.name ?? ""} ${error?.message ?? ""}`,
  );

  useEffect(() => {
    console.error(error);
    // A stale tab asking for JS chunks from a previous deployment: reload once to pick up the
    // current build (guarded so a genuinely broken page can't reload-loop).
    if (isChunkError && typeof window !== "undefined") {
      const key = "zan-app:chunk-reload";
      const last = Number(window.sessionStorage.getItem(key) ?? 0);
      if (!last || Date.now() - last > 60_000) {
        window.sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
      }
    }
  }, [error, isChunkError]);

  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm" role="alert">
      <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
      <p className="mt-2 text-sm text-gray-600">
        {isChunkError
          ? "A new version of Zan-APP was released while this tab was open. Reload to continue."
          : "This page hit an unexpected error. You can try again, or reload the page."}
      </p>
      {error?.digest && <p className="mt-2 font-mono text-xs text-gray-400">Ref: {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-3">
        <button type="button" onClick={() => reset()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.sessionStorage.removeItem("zan-app:chunk-reload");
              window.location.reload();
            }
          }}
          className="btn-primary px-4 py-2 text-sm"
        >
          Reload page
        </button>
      </div>
    </div>
  );
}
