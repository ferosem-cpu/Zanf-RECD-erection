-- Management = every permission EXCEPT manage_settings (Settings is Super Admin only).
--
-- Why: seed.ts has always defined Management as ALL_PERMISSIONS minus manage_settings, but the
-- seed is not run against production. Production's role-permission rows were created/extended
-- by hand (direct SQL via the Supabase MCP, one permission and a hand-picked list of roles at a
-- time), and before this migration only 20260827034238_add_vendor_invoice_workflow granted
-- anything to Management in a migration. Production Management users could therefore be
-- missing manage_orders / view_orders / view_site_status / finance keys, which hides Orders,
-- Sites and Customers (nav gated client-side, GET /orders|/sites|/customers 403 server-side).
--
-- Idempotent and data-only: safe to run on any DB, any number of times. Looks everything up by
-- key (never by id). Touches ONLY the Management role's RolePermission rows (plus inserting any
-- Permission row that doesn't exist yet). Other roles are untouched.

-- 1) Make sure every permission key the code knows about exists (mirrors
--    prisma/roleDefinitions.ts PERMISSION_DEFINITIONS). No-op for keys already present.
INSERT INTO "Permission" (id, key, name, description) VALUES
  (gen_random_uuid()::text, 'view_site_status', 'View site status', NULL),
  (gen_random_uuid()::text, 'change_site_status', 'Change site status', NULL),
  (gen_random_uuid()::text, 'view_dashboard', 'View dashboard', NULL),
  (gen_random_uuid()::text, 'view_complaints_overview', 'View company-wide complaints overview', NULL),
  (gen_random_uuid()::text, 'manage_complaints', 'Manage / resolve complaints', NULL),
  (gen_random_uuid()::text, 'raise_complaint', 'Raise a complaint', NULL),
  (gen_random_uuid()::text, 'manage_orders', 'Create / manage orders', NULL),
  (gen_random_uuid()::text, 'view_orders', 'View orders and order value (read-only)', NULL),
  (gen_random_uuid()::text, 'manage_users', 'Add users and assign roles', NULL),
  (gen_random_uuid()::text, 'resolve_pending_action', 'Resolve a pending action', NULL),
  (gen_random_uuid()::text, 'manage_settings', 'Manage company settings and theming', NULL),
  (gen_random_uuid()::text, 'act_assigned_complaints', 'Act on complaints assigned to you', NULL),
  (gen_random_uuid()::text, 'manage_vendors', 'Approve and manage external vendors', NULL),
  (gen_random_uuid()::text, 'manage_work_orders', 'Create and assign work orders to field crews', NULL),
  (gen_random_uuid()::text, 'act_assigned_work_orders', 'Act on work orders assigned to you', NULL),
  (gen_random_uuid()::text, 'place_order', 'Submit a new order request (Customer Portal)', NULL),
  (gen_random_uuid()::text, 'manage_quotations', 'Create and manage quotations', NULL),
  (gen_random_uuid()::text, 'manage_invoices', 'Create and issue invoices (proforma + tax)', NULL),
  (gen_random_uuid()::text, 'record_payments', 'Record payments received and made', NULL),
  (gen_random_uuid()::text, 'manage_purchase_orders', 'Manage suppliers, purchase orders, and bills', NULL),
  (gen_random_uuid()::text, 'manage_expenses', 'Manage the expense book', NULL),
  (gen_random_uuid()::text, 'view_finance_dashboard', 'View finance dashboard and reports', NULL),
  (gen_random_uuid()::text, 'record_vendor_invoice', 'Upload / capture a vendor invoice', NULL),
  (gen_random_uuid()::text, 'approve_vendor_invoice', 'Verify, approve, or reject a vendor invoice', NULL),
  (gen_random_uuid()::text, 'view_ledgers', 'View party ledger statements, TDS report, and GST exports', NULL),
  (gen_random_uuid()::text, 'manage_credit_notes', 'Create, issue, and cancel credit notes and debit notes', NULL)
ON CONFLICT (key) DO NOTHING;

-- 2) Grant Management every permission in the table except manage_settings (covers any
--    permission added directly in prod too, not just the list above).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "Role" r
CROSS JOIN "Permission" p
WHERE r.key = 'management'
  AND p.key <> 'manage_settings'
ON CONFLICT DO NOTHING;

-- 3) Settings stays Super Admin only: drop manage_settings from Management if it was ever granted.
DELETE FROM "RolePermission" rp
USING "Role" r, "Permission" p
WHERE rp."roleId" = r.id
  AND rp."permissionId" = p.id
  AND r.key = 'management'
  AND p.key = 'manage_settings';
