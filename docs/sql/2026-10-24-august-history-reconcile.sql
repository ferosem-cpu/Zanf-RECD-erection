-- August migration history reconcile (PLAN, NOT RUN) - 2026-10-24. History rows only; requires Ferose's OK.
-- If the count is not 38, ROLLBACK instead of COMMIT.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT 'b8957ab2-efa5-404a-978a-b96d45b613cb','85af69e0dae7582cf8aafe8f1e5ed4205879379657c1bd6dafcf9cfd505e7e60',now(),'20260813122825_add_product_shape_dimensions_weight',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260813122825_add_product_shape_dimensions_weight');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '47023597-c4c1-464d-b8ea-0bdaa7384d51','94d6fe1fad2600ebde6cd2c07b75c6a09ac91f437ce27395be0a7f2ff0a92db9',now(),'20260817000000_add_vendor_archive',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260817000000_add_vendor_archive');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '03342681-022f-480e-ac3b-0f5563f76231','696f3194401ea455d082b94392a3eb46266840690bdc2507d7f98d1885ec04ed',now(),'20260817120000_add_order_line_items',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260817120000_add_order_line_items');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '10f51c83-5372-4d32-b054-f728b32a9f02','3a6e387ad23b2c5ceb0a16a9d08eb0f00d409a2d0becc849d7491f4ccf636d63',now(),'20260822155035_add_agent_custom_instructions_and_saved_line_items',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260822155035_add_agent_custom_instructions_and_saved_line_items');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT 'a6f25359-7cf7-44e5-9383-1243b2a60219','ab38d6cdfbb47cb47b387d0fbdc1abcec1cf232e0e2fa477ba542e627a924efb',now(),'20260823065413_add_customer_product_and_saved_item_pricing',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260823065413_add_customer_product_and_saved_item_pricing');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT 'bb2f1b46-8083-4de9-90af-f8a0d612dfd0','aa6aef2a9651069c200c762155e3e1a24154f2d1a1f2bb860ef2debc5b3656ba',now(),'20260823134430_add_product_silencer_type',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260823134430_add_product_silencer_type');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT 'c254cb48-9f9f-4f4e-a65b-6cf850df780b','fca21511919867779465da18e37d07439a8d25d3a84d903fc72ac3a894c75b60',now(),'20260824062957_add_work_order_products',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260824062957_add_work_order_products');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '47f22d79-21ab-400c-b83c-77b35752cf93','973818a01c00cb1b29ca89ff9bea6847716a106cdd92e4ea0d8432ae97c4b3a5',now(),'20260827034238_add_vendor_invoice_workflow',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260827034238_add_vendor_invoice_workflow');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '82f72871-0fb7-4420-8e52-ee9704f0f9d0','f5999c5d4e256aea4361b23f8e1a573ae748095d59c5fc1c27b9ec36323ae49f',now(),'20260827094832_add_supplier_pan',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260827094832_add_supplier_pan');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '903b080c-ea97-4b69-b75a-368a76ecfe05','9e8b352d5e85096902440d8ffda1458eb33b6e140c81d8b214420b945a0de4fb',now(),'20260827144444_add_customer_purchase_orders',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260827144444_add_customer_purchase_orders');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT 'cf6e7fac-2f3b-4cc9-8ba7-6e22c82f2908','f517f85eec539d49f82b2a26fcac48362c46d40d76116dde4bba938ef4364d14',now(),'20260828111339_add_ledger_opening_balances',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260828111339_add_ledger_opening_balances');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT 'e4e86e28-89d2-40c4-8fe3-10fc67d1b58e','7a948b59796bff5442ad8b444cca157af7c00ee02fb5c2b60421be86af0ea7c4',now(),'20260828120209_add_credit_debit_notes',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260828120209_add_credit_debit_notes');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '617ede11-c8e4-4f59-9142-0461e7da02d4','7356bdbf9323894508ca617ffec65bc80a181c4aa8c3fa81c16cf9e3ff4a95ce',now(),'20260828160000_add_payment_allocations',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260828160000_add_payment_allocations');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '562a928f-b0a3-466d-8a62-8a265f835a6f','f3228934b90494fcb9df4817298bf7e918096f2b7780a27dc69a4a410d64a1f1',now(),'20260828170000_add_payment_order_tag',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260828170000_add_payment_order_tag');
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT '63477f27-04fc-4471-8770-6f08676a0850','44ac8c2b138fe2c88527bae09b6cf31e9b6e769c8ad867b5808ebcdff427e590',now(),'20260829054500_add_backup_settings_and_log',NULL,NULL,now(),1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20260829054500_add_backup_settings_and_log');
SELECT count(*) FROM "_prisma_migrations"; -- expect 38; if not 38 -> ROLLBACK;
COMMIT;
