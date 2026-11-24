import { COMPLAINT_STATUS } from "@recd/shared";

export type ComplaintDeleteFacts = { status: string; comments: number; attachments: number };

/** Why a complaint cannot be deleted, or null when it is a still-open ticket nobody has touched. */
export function complaintDeleteBlocker(f: ComplaintDeleteFacts): string | null {
  if (f.status !== COMPLAINT_STATUS.OPEN) {
    return `Only an open complaint can be deleted - this one is "${f.status.replaceAll("_", " ")}". Close it instead.`;
  }
  if (f.comments > 0) return `Cannot delete this complaint - it has ${f.comments} comment(s). Close it instead.`;
  if (f.attachments > 0) return `Cannot delete this complaint - it has ${f.attachments} attached file(s). Close it instead.`;
  return null;
}

type Tx = {
  complaint: {
    findUnique(a: any): PromiseLike<any>;
    delete(a: any): PromiseLike<unknown>;
  };
};

/** Re-checks inside the transaction (so a comment added meanwhile wins) and deletes. Files in Drive/Storage are left alone. */
export async function deleteOpenComplaint(tx: Tx, id: string): Promise<{ ok: true } | { ok: false; status: 404 | 409; error: string }> {
  const c = await tx.complaint.findUnique({
    where: { id },
    select: { status: true, _count: { select: { comments: true, portalAttachments: true } } },
  });
  if (!c) return { ok: false, status: 404, error: "Complaint not found" };
  const blocker = complaintDeleteBlocker({ status: c.status, comments: c._count.comments, attachments: c._count.portalAttachments });
  if (blocker) return { ok: false, status: 409, error: blocker };
  await tx.complaint.delete({ where: { id } });
  return { ok: true };
}
