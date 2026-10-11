-- PROPOSAL (not applied anywhere): enable Row Level Security on the four WhatsApp tables.
-- Why: Supabase default privileges in schema public grant the anon and authenticated roles full
-- table privileges on every NEW table, so without RLS these tables (sender phone numbers, message
-- text, queued replies) would be readable and writable through the Supabase Data API with the
-- public anon key. No policies are created: the application connects with a role that bypasses
-- RLS (the same is already true for the 39 RLS-enabled tables without policies), so the API is
-- unaffected, and anon/authenticated get no rows.

ALTER TABLE "WhatsappSenderMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsappBridgeNonce" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsappInbound" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhatsappOutbox" ENABLE ROW LEVEL SECURITY;
