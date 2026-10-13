ALTER TABLE "obrt_profiles" ADD CONSTRAINT "obrt_profiles_oib_format" CHECK ("obrt_profiles"."oib" ~ '^[0-9]{11}$');--> statement-breakpoint
ALTER TABLE "obrt_profiles" ADD CONSTRAINT "obrt_profiles_country_code_format" CHECK ("obrt_profiles"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_oib_format" CHECK ("customers"."oib" ~ '^[0-9]{11}$');--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_country_code_format" CHECK ("customers"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_currency_format" CHECK ("items"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kpd_code_format" CHECK ("items"."kpd_code" ~ '^[0-9]{6}$');--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Review items N1 and N3, hand-written (Drizzle does not model triggers or policy rewrites).
--
-- N3: the policies treat an empty app.org_id as unset. NULLIF turns '' (what a connection holds
-- after a transaction that used set_config(..., true)) into NULL, and `organization_id = NULL`
-- matches no row, so an empty setting can never match a row whose organization_id is ''.
-- ---------------------------------------------------------------------------------------------

DROP POLICY "tenant_isolation" ON "obrt_profiles";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "obrt_profiles" AS PERMISSIVE FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.org_id', true), ''));--> statement-breakpoint

DROP POLICY "tenant_isolation" ON "customers";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.org_id', true), ''));--> statement-breakpoint

DROP POLICY "tenant_isolation" ON "items";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "items" AS PERMISSIVE FOR ALL
  USING ("organization_id" = NULLIF(current_setting('app.org_id', true), ''))
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.org_id', true), ''));--> statement-breakpoint

DROP POLICY "tenant_select" ON "audit_log";--> statement-breakpoint
CREATE POLICY "tenant_select" ON "audit_log" AS PERMISSIVE FOR SELECT
  USING ("organization_id" = NULLIF(current_setting('app.org_id', true), ''));--> statement-breakpoint
DROP POLICY "tenant_insert" ON "audit_log";--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "audit_log" AS PERMISSIVE FOR INSERT
  WITH CHECK ("organization_id" = NULLIF(current_setting('app.org_id', true), ''));--> statement-breakpoint

-- N1: TRUNCATE skips row triggers and RLS, so audit_log gets a statement-level trigger on it too.
-- forbid_mutation() already reports TG_OP, so it serves unchanged.
CREATE TRIGGER "audit_log_no_truncate"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION public.forbid_mutation();
