-- Enable Row Level Security on the 25 public tables that had it off (Supabase advisor
-- "RLS Disabled in Public", ERROR). NO policies are added on purpose: with RLS on and no policy,
-- the Supabase Data API roles `anon` and `authenticated` see zero rows and cannot write, while the
-- app is unaffected because Prisma connects as `postgres`, which owns these tables and has
-- BYPASSRLS (FORCE ROW LEVEL SECURITY stays off). `service_role` also has BYPASSRLS.
-- The other 39 public tables already have RLS on with no policies; employees/company_settings
-- (zanf-ebiz-card) are untouched. Rollback: ALTER TABLE ... DISABLE ROW LEVEL SECURITY per table.
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
