/** Customer Portal e-mails sent by the API (staff alerts, customer notices). Best effort: never throws. */
import { sendEmail } from "../lib/email";

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const portalBase = (): string => (process.env.PORTAL_BASE_URL || "https://portal.zanf.org").replace(/\/$/, "");
export const STAFF_ALERT_MAILBOX = "info@zanf.org";

export interface MailSite {
  name: string; city: string; pincode: string; ratingKva: number; contact: string;
  priority: string; priorityReason?: string | null; startBy?: string | null; completeBy?: string | null; formalities: string[];
}
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export function buildStaffOrderMail(a: { customer: string; reference: string; orderNumbers: string[]; sites: MailSite[]; po?: string | null; notes?: string | null; byKva: Record<string, number> }) {
  const sites = [...a.sites].sort((x, y) => (PRIORITY_RANK[x.priority] ?? 9) - (PRIORITY_RANK[y.priority] ?? 9));
  const critical = sites.some((s) => s.priority === "critical");
  const subject = (critical ? "[CRITICAL] " : "") + "New order from " + a.customer + " via portal: " + sites.length + " site" + (sites.length === 1 ? "" : "s") + " (" + a.reference + ")";
  const kva = Object.entries(a.byKva).map(([k, n]) => n + " x " + k + " kVA").join(", ");
  const line = (s: MailSite) => [s.priority.toUpperCase() + (s.priorityReason ? " (" + s.priorityReason + ")" : ""), s.name, s.city + " " + s.pincode, s.ratingKva + " kVA", s.contact, s.startBy || "-", s.completeBy || "-", s.formalities.join("/") || "-"].join(" | ");
  const text = [subject, "", "Customer: " + a.customer, "PO: " + (a.po || "not given"), "Orders: " + a.orderNumbers.join(", "), "Totals: " + kva, a.notes ? "Notes: " + a.notes : "", "", "Priority | Site | Location | Rating | Contact | Start by | Complete by | Formalities", ...sites.map(line)].filter((x) => x !== "").join("\n");
  const rows = sites.map((s) => "<tr><td>" + esc(s.priority) + (s.priorityReason ? "<br><small>" + esc(s.priorityReason) + "</small>" : "") + "</td><td>" + esc(s.name) + "</td><td>" + esc(s.city) + " " + esc(s.pincode) + "</td><td>" + s.ratingKva + " kVA</td><td>" + esc(s.contact) + "</td><td>" + esc(s.startBy || "-") + "</td><td>" + esc(s.completeBy || "-") + "</td><td>" + esc(s.formalities.join(", ") || "-") + "</td></tr>").join("");
  const html = "<p><b>" + esc(subject) + "</b></p><p>Customer: " + esc(a.customer) + "<br>PO: " + esc(a.po || "not given") + "<br>Orders: " + esc(a.orderNumbers.join(", ")) + "<br>Totals: " + esc(kva) + (a.notes ? "<br>Notes: " + esc(a.notes) : "") + "</p><table border='1' cellpadding='4' cellspacing='0'><tr><th>Priority</th><th>Site</th><th>Location</th><th>Rating</th><th>Contact</th><th>Start by</th><th>Complete by</th><th>Formalities</th></tr>" + rows + "</table>";
  return { subject, text, html };
}

export async function mailStaffNewOrder(m: ReturnType<typeof buildStaffOrderMail>): Promise<boolean> {
  try { return await sendEmail({ to: STAFF_ALERT_MAILBOX, ...m }); } catch { return false; }
}

export async function mailStaffPriorityChange(a: { customer: string; site: string; priority: string; reason?: string | null }): Promise<boolean> {
  const subject = (a.priority === "critical" ? "[CRITICAL] " : "") + "Priority changed to " + a.priority + ": " + a.site + " (" + a.customer + ")";
  const text = subject + (a.reason ? "\nReason: " + a.reason : "");
  const html = "<p>" + esc(subject) + (a.reason ? "<br>Reason: " + esc(a.reason) : "") + "</p>";
  try { return await sendEmail({ to: STAFF_ALERT_MAILBOX, subject, text, html }); } catch { return false; }
}

export async function mailCustomer(a: { to: string; subject: string; lines: string[]; path: string }): Promise<boolean> {
  const url = portalBase() + a.path;
  const text = [...a.lines, "", "Open in the portal (sign-in required): " + url, "", "Zan-F Power Systems"].join("\n");
  const html = a.lines.map((l) => "<p>" + esc(l) + "</p>").join("") + "<p><a href='" + esc(url) + "'>Open in the portal</a> (sign-in required)</p><p>Zan-F Power Systems</p>";
  try { return await sendEmail({ to: a.to, subject: a.subject, text, html }); } catch { return false; }
}
