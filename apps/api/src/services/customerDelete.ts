import { Prisma } from "@prisma/client";
import { ROLE_KEY } from "@recd/shared";

/** Counts of operational/financial records that must block deleting a customer. */
export type CustomerBlockerCounts = {
  orders: number;
  quotations: number;
  invoices: number;
  complaints: number;
  paymentsReceived: number;
  creditNotes: number;
  purchaseOrders: number;
};

const LABELS: [keyof CustomerBlockerCounts, string][] = [
  ["orders", "order(s)/site(s)"],
  ["quotations", "quotation(s)"],
  ["invoices", "invoice(s)"],
  ["complaints", "complaint(s)"],
  ["paymentsReceived", "payment(s) received"],
  ["creditNotes", "credit note(s)"],
  ["purchaseOrders", "customer purchase order(s)"],
];

/** Only the non-zero blockers, e.g. { orders: 1, complaints: 1 }. */
export function nonZeroBlockers(c: CustomerBlockerCounts): Partial<CustomerBlockerCounts> {
  const out: Partial<CustomerBlockerCounts> = {};
  for (const [k] of LABELS) if (c[k] > 0) out[k] = c[k];
  return out;
}

/** Human message for the 409 response; null when nothing blocks. Same style as the order delete route. */
export function customerBlockerMessage(c: CustomerBlockerCounts): string | null {
  const parts = LABELS.filter(([k]) => c[k] > 0).map(([k, label]) => `${c[k]} ${label}`);
  if (!parts.length) return null;
  return `Cannot delete this customer - it has linked records: ${parts.join(", ")}. Delete or resolve those first (orders and quotations can be deleted from their own pages).`;
}

export const CUSTOMER_FK_MESSAGE =
  "Cannot delete this customer - one of its portal contacts is still referenced by other records. Deactivate the contact instead.";

type Db = {
  order: { count(a: any): Promise<number> };
  quotation: { count(a: any): Promise<number> };
  invoice: { count(a: any): Promise<number> };
  complaint: { count(a: any): Promise<number> };
  paymentReceived: { count(a: any): Promise<number> };
  creditNote: { count(a: any): Promise<number> };
  customerPurchaseOrder: { count(a: any): Promise<number> };
};

export async function countCustomerBlockers(db: Db, customerId: string): Promise<CustomerBlockerCounts> {
  const where = { where: { customerId } };
  const [orders, quotations, invoices, complaints, paymentsReceived, creditNotes, purchaseOrders] = await Promise.all([
    db.order.count(where), db.quotation.count(where), db.invoice.count(where), db.complaint.count(where),
    db.paymentReceived.count(where), db.creditNote.count(where), db.customerPurchaseOrder.count(where),
  ]);
  return { orders, quotations, invoices, complaints, paymentsReceived, creditNotes, purchaseOrders };
}

/**
 * Removes a customer that has NO operational records (caller must have checked the blockers):
 * its CUSTOMER-role portal users and their login/portal leftovers (OTP codes, WhatsApp sender
 * mappings, portal.session/otp_challenge/notification/audit_log/order_draft rows), staged
 * portal uploads and empty submissions. Locations, product prices and saved-item prices go
 * through ON DELETE CASCADE. Runs inside the supplied transaction client.
 */
export async function deleteCustomerWithPortalData(tx: Prisma.TransactionClient, customerId: string): Promise<void> {
  const users = await tx.user.findMany({ where: { customerId, role: { key: ROLE_KEY.CUSTOMER } }, select: { id: true } });
  const userIds = users.map((u) => u.id);

  // portal.* tables are owned by the portal app and have no FKs; clear them so no orphan sessions/drafts survive.
  // Best effort inside a savepoint: a missing table or grant must not block the customer delete itself.
  await tx.$executeRawUnsafe("SAVEPOINT customer_delete_portal");
  try {
    for (const t of ["session", "otp_challenge", "notification", "audit_log"]) {
      await tx.$executeRawUnsafe(`DELETE FROM portal.${t} WHERE user_id = ANY($1::text[])`, userIds);
    }
    await tx.$executeRawUnsafe("DELETE FROM portal.order_draft WHERE customer_id = $1 OR user_id = ANY($2::text[])", customerId, userIds);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT customer_delete_portal");
  } catch {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT customer_delete_portal");
  }

  if (userIds.length) {
    await tx.whatsappSenderMapping.deleteMany({ where: { userId: { in: userIds } } });
    await tx.user.deleteMany({ where: { id: { in: userIds } } }); // OtpCode / AgentConversation cascade
  }
  // No orders/complaints exist (checked), so remaining attachments are unlinked drafts; submissions have no orders.
  await tx.portalAttachment.deleteMany({ where: { customerId } });
  await tx.portalSubmission.deleteMany({ where: { customerId } });
  await tx.customer.delete({ where: { id: customerId } });
}
