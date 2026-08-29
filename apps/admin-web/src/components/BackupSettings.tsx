"use client";

import { useState, useEffect, useCallback } from "react";
import { api, downloadFileFromApi } from "@/lib/apiClient";
import { useAuth } from "@/components/AuthContext";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface BackupSettingsData {
  scheduleEnabled: boolean;
  scheduleDayOfWeek: number;
  method: "FULL" | "INCREMENTAL";
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

interface BackupLogRow {
  id: string;
  method: "FULL" | "INCREMENTAL";
  trigger: string;
  status: string;
  startedAt: string;
  rowCount: number | null;
  sizeBytes: number | null;
  driveFileLink: string | null;
  triggeredBy: { name: string } | null;
}

export default function BackupSettings() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("manage_settings");

  const [settings, setSettings] = useState<BackupSettingsData | null>(null);
  const [logs, setLogs] = useState<BackupLogRow[]>([]);
  const [runMethod, setRunMethod] = useState<"FULL" | "INCREMENTAL">("FULL");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        api<BackupSettingsData>("/backup/settings"),
        api<BackupLogRow[]>("/backup/logs"),
      ]);
      setSettings(s);
      setRunMethod(s.method);
      setLogs(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (canManage) load();
  }, [canManage, load]);

  if (!canManage || !settings) return null;

  async function runNow() {
    setRunning(true);
    setError(null);
    try {
      await downloadFileFromApi("/backup/run", {
        method: "POST",
        body: JSON.stringify({ method: runMethod }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function updateSetting(patch: Partial<BackupSettingsData>) {
    setSaving(true);
    setError(null);
    const next = { ...settings!, ...patch };
    setSettings(next);
    try {
      await api("/backup/settings", { method: "PUT", body: JSON.stringify(patch) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function formatSize(bytes: number | null) {
    if (bytes === null) return "-";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  return (
    <section className="card p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold mb-1">Backup</h2>
      <p className="text-sm text-gray-500 mb-4">
        Back up the database on demand, or turn on a weekly automatic backup uploaded to the
        company Google Drive (ZanF_DropBox &rarr; Backups). Manual backups download straight
        to your browser instead.
      </p>

      {error && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          value={runMethod}
          onChange={(e) => setRunMethod(e.target.value as "FULL" | "INCREMENTAL")}
        >
          <option value="FULL">Full backup</option>
          <option value="INCREMENTAL">Incremental (since last full backup)</option>
        </select>
        <button className="btn-primary px-4 py-2 text-sm" onClick={runNow} disabled={running}>
          {running ? "Backing up…" : "Backup Now"}
        </button>
        {settings.lastRunAt && (
          <span className="text-xs text-gray-500">
            Last run: {new Date(settings.lastRunAt).toLocaleString()} ({settings.lastRunStatus})
          </span>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 mb-6">
        <h3 className="text-sm font-semibold mb-2">Weekly automatic backup</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.scheduleEnabled}
              disabled={saving}
              onChange={(e) => updateSetting({ scheduleEnabled: e.target.checked })}
            />
            Enabled
          </label>
          <select
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={settings.scheduleDayOfWeek}
            disabled={saving}
            onChange={(e) => updateSetting({ scheduleDayOfWeek: Number(e.target.value) })}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={settings.method}
            disabled={saving}
            onChange={(e) => updateSetting({ method: e.target.value as "FULL" | "INCREMENTAL" })}
          >
            <option value="FULL">Full</option>
            <option value="INCREMENTAL">Incremental</option>
          </select>
          <span className="text-xs text-gray-500">
            Runs around 1:00 AM IST on the selected day.
          </span>
        </div>
      </div>

      <div className="border-t border-gray-100 pt-4">
        <h3 className="text-sm font-semibold mb-2">Recent backups</h3>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">No backups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Method</th>
                  <th className="py-1 pr-3">Trigger</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Rows</th>
                  <th className="py-1 pr-3">Size</th>
                  <th className="py-1 pr-3">Drive</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-50">
                    <td className="py-1 pr-3">{new Date(log.startedAt).toLocaleString()}</td>
                    <td className="py-1 pr-3">{log.method}</td>
                    <td className="py-1 pr-3">
                      {log.trigger === "manual" && log.triggeredBy ? `manual (${log.triggeredBy.name})` : log.trigger}
                    </td>
                    <td className="py-1 pr-3">{log.status}</td>
                    <td className="py-1 pr-3">{log.rowCount ?? "-"}</td>
                    <td className="py-1 pr-3">{formatSize(log.sizeBytes)}</td>
                    <td className="py-1 pr-3">
                      {log.driveFileLink ? (
                        <a href={log.driveFileLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          Open
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
