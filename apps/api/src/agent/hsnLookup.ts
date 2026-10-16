import { prisma } from "../lib/prisma";

/** Reuse the HSN/SAC code already used for the same kind of line on earlier invoices.
 *
 * Why: the agent used to refuse any invoice line without an HSN/SAC and ask the user, even for
 * lines like "Panel board fixing, connection testing, logistics" that every earlier invoice
 * bills under the same code. Earlier invoice descriptions are "<service> - <site>" (hyphen or
 * en dash), so the part before the separator is the service name and is what we match on.
 * Nothing here ever invents a code: a miss returns null and the caller asks the user. */

export interface HsnMatch {
  hsnCode: string;
  /** Human-readable origin, shown to the user so they can check it. */
  source: string;
}

export interface HsnCandidate {
  description: string;
  hsnCode: string;
  uses: number;
}

const SEPARATOR = /\s+[–—-]\s+/;

/** "Panel board fixing, logistics - VRL Belgaum" -> "Panel board fixing, logistics". */
export function coreDescription(description: string): string {
  return description.split(SEPARATOR)[0].replace(/\s+/g, " ").trim();
}

const key = (s: string) => coreDescription(s).toLowerCase();
const clean = (code: string | null | undefined) => (code ?? "").trim();

/** Look up the code for one line: saved billing items first (the deliberately maintained
 * list), then the most-used code among earlier invoice lines with the same service name. */
export async function resolveHsnFromHistory(description: string): Promise<HsnMatch | null> {
  const core = coreDescription(description);
  if (core.length < 3) return null;

  const saved = await prisma.savedLineItem.findMany({
    where: {
      active: true,
      hsnCode: { not: null },
      OR: [
        { name: { equals: core, mode: "insensitive" } },
        { name: { equals: description.trim(), mode: "insensitive" } },
      ],
    },
    take: 5,
  });
  const savedHit = saved.find((s) => clean(s.hsnCode));
  if (savedHit) return { hsnCode: clean(savedHit.hsnCode), source: `saved billing item "${savedHit.name}"` };

  const rows = await prisma.invoiceLineItem.findMany({
    where: { hsnCode: { not: null }, description: { contains: core, mode: "insensitive" } },
    orderBy: { invoice: { createdAt: "desc" } },
    take: 50,
    select: { description: true, hsnCode: true },
  });
  const same = rows.filter((r) => clean(r.hsnCode) && key(r.description) === core.toLowerCase());
  if (same.length === 0) return null;

  // Most-used code wins; on a tie the most recent invoice (rows are newest first) wins.
  const counts = new Map<string, number>();
  for (const r of same) counts.set(clean(r.hsnCode), (counts.get(clean(r.hsnCode)) ?? 0) + 1);
  let best = clean(same[0].hsnCode);
  for (const [code, n] of counts) if (n > (counts.get(best) ?? 0)) best = code;
  return {
    hsnCode: best,
    source: `${counts.get(best)} earlier invoice line(s) named "${core}"`,
  };
}

/** Codes earlier invoices actually used, most-used first, one row per service name + code.
 * Shown to the model when a line has no match so it can pick a same-kind line, or ask. */
export async function listHsnCandidates(limit = 10): Promise<HsnCandidate[]> {
  const groups = await prisma.invoiceLineItem.groupBy({
    by: ["description", "hsnCode"],
    where: { hsnCode: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { description: "desc" } },
    take: 200,
  });
  const merged = new Map<string, HsnCandidate>();
  for (const g of groups) {
    const code = clean(g.hsnCode);
    if (!code) continue;
    const core = coreDescription(g.description);
    const k = `${core.toLowerCase()}|${code}`;
    const existing = merged.get(k);
    if (existing) existing.uses += g._count._all;
    else merged.set(k, { description: core, hsnCode: code, uses: g._count._all });
  }
  return [...merged.values()].sort((a, b) => b.uses - a.uses).slice(0, limit);
}
