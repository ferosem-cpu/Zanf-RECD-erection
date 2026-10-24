/** Server-side percentage split of an amount across invoice lines.
 *
 * Why: asked to "divide 65000 and 100000 in the following percentages" the model did the
 * arithmetic itself and got it wrong (41,155 / 6,995 / 4,015 / 12,535 instead of 41,502.50 /
 * 7,000.50 / 3,997.50 / 12,499.50), which the user then had to fix by hand. Now the model only
 * says "this line is X% of Y" and the app computes the money, rounded to paise, with the last
 * line of each group absorbing the rounding so a group of 100% always adds up to exactly Y.
 */
export interface SplitLineInput {
  quantity?: number;
  unitPrice?: number;
  splitTotal?: number;
  splitPct?: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function applyPercentSplits<T extends SplitLineInput>(lines: T[]): { error: string } | { notes: string[] } {
  const groups = new Map<number, number[]>();
  for (const [i, li] of lines.entries()) {
    const hasTotal = li.splitTotal !== undefined && li.splitTotal !== null;
    const hasPct = li.splitPct !== undefined && li.splitPct !== null;
    if (!hasTotal && !hasPct) continue;
    if (!hasTotal || !hasPct) return { error: `Line item ${i + 1}: splitTotal and splitPct must be given together.` };
    if (!Number.isFinite(li.splitTotal) || (li.splitTotal as number) <= 0) return { error: `Line item ${i + 1}: splitTotal must be a positive amount.` };
    if (!Number.isFinite(li.splitPct) || (li.splitPct as number) <= 0 || (li.splitPct as number) > 100) {
      return { error: `Line item ${i + 1}: splitPct must be between 0 and 100.` };
    }
    const key = li.splitTotal as number;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }

  const notes: string[] = [];
  for (const [total, idxs] of groups) {
    const pctSum = idxs.reduce((s, i) => s + (lines[i].splitPct as number), 0);
    for (const i of idxs) {
      lines[i].unitPrice = round2((total * (lines[i].splitPct as number)) / 100);
      lines[i].quantity = lines[i].quantity ?? 1;
    }
    if (Math.abs(pctSum - 100) <= 0.01) {
      const allocated = round2(idxs.slice(0, -1).reduce((s, i) => s + (lines[i].unitPrice as number), 0));
      lines[idxs[idxs.length - 1]].unitPrice = round2(total - allocated);
      notes.push(`Split of ${total}: ${idxs.length} lines at ${pctSum.toFixed(2)}% add up to exactly ${total}.`);
    } else {
      notes.push(`Split of ${total}: the percentages add up to ${round2(pctSum)}%, not 100%, so the lines add up to ${round2(idxs.reduce((s, i) => s + (lines[i].unitPrice as number), 0))} - tell the user.`);
    }
  }
  return { notes };
}
