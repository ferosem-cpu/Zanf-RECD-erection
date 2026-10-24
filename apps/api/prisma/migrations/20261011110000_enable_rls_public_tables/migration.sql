-- Security: enable Row Level Security on the 25 public Zan tables that had it off (Supabase advisor
-- "RLS Disabled in Public", ERROR) and revoke the Supabase Data API roles' table grants on those same
-- 25 tables only. No policies are added on purpose: anon/authenticated get no rows and no grants, while
-- the app is unaffected (Prisma connects as postgres = table owner + BYPASSRLS; FORCE RLS stays off;
-- service_role keeps BYPASSRLS and its grants). Per-table REVOKE only - never ON ALL TABLES, because the
-- zanf-ebiz-card tables (employees, company_settings) in the same schema must keep their anon grants.
-- Prisma does not wrap PostgreSQL migrations in a transaction, so this file does it explicitly, with a
-- short lock timeout: all 50 statements apply or none do.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "AgentConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLlmProvider" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentPendingAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BillLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditNoteLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerProductPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPurchaseOrderAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPurchaseOrderLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerSavedItemPrice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DebitNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentRequirementType" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentOrderTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecdDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedLineItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteContact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteDocumentRequirement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkOrderProduct" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AgentConversation" FROM anon, authenticated;
REVOKE ALL ON TABLE "AgentLlmProvider" FROM anon, authenticated;
REVOKE ALL ON TABLE "AgentPendingAction" FROM anon, authenticated;
REVOKE ALL ON TABLE "BackupLog" FROM anon, authenticated;
REVOKE ALL ON TABLE "BackupSettings" FROM anon, authenticated;
REVOKE ALL ON TABLE "BillAllocation" FROM anon, authenticated;
REVOKE ALL ON TABLE "BillAuditLog" FROM anon, authenticated;
REVOKE ALL ON TABLE "BillLineItem" FROM anon, authenticated;
REVOKE ALL ON TABLE "CreditNote" FROM anon, authenticated;
REVOKE ALL ON TABLE "CreditNoteLineItem" FROM anon, authenticated;
REVOKE ALL ON TABLE "CustomerProductPrice" FROM anon, authenticated;
REVOKE ALL ON TABLE "CustomerPurchaseOrder" FROM anon, authenticated;
REVOKE ALL ON TABLE "CustomerPurchaseOrderAuditLog" FROM anon, authenticated;
REVOKE ALL ON TABLE "CustomerPurchaseOrderLineItem" FROM anon, authenticated;
REVOKE ALL ON TABLE "CustomerSavedItemPrice" FROM anon, authenticated;
REVOKE ALL ON TABLE "DebitNote" FROM anon, authenticated;
REVOKE ALL ON TABLE "DocumentRequirementType" FROM anon, authenticated;
REVOKE ALL ON TABLE "OrderLineItem" FROM anon, authenticated;
REVOKE ALL ON TABLE "PaymentAllocation" FROM anon, authenticated;
REVOKE ALL ON TABLE "PaymentOrderTag" FROM anon, authenticated;
REVOKE ALL ON TABLE "RecdDelivery" FROM anon, authenticated;
REVOKE ALL ON TABLE "SavedLineItem" FROM anon, authenticated;
REVOKE ALL ON TABLE "SiteContact" FROM anon, authenticated;
REVOKE ALL ON TABLE "SiteDocumentRequirement" FROM anon, authenticated;
REVOKE ALL ON TABLE "WorkOrderProduct" FROM anon, authenticated;
COMMIT;
