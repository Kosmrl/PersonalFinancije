-- Tenant layer, build-sequence step 5 of docs/plans/2026-10-09-phase-1-foundation.md
-- ("Database roles", "Data model changes", "Migrations"). Custom migration, run as pf_owner.
--
-- The CHECK constraints of the plan (kind values, HR business needs OIB, in_vat_system = false,
-- unit_price >= 0) are expressible in Drizzle and live in 0002_tenant_tables.sql with the tables.
--
-- Under FORCE ROW LEVEL SECURITY even pf_owner sees only rows of the organization named in
-- app.org_id, so a data migration touching these tables must set it first.

-- ---------------------------------------------------------------------------------------------
-- Row-level security. current_setting('app.org_id', true) is NULL (or '' after a finished
-- transaction) when no tenant context was set, which matches no row.
-- ---------------------------------------------------------------------------------------------

ALTER TABLE "obrt_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "obrt_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "obrt_profiles" AS PERMISSIVE FOR ALL
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "items" AS PERMISSIVE FOR ALL
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- audit_log: SELECT and INSERT policies only. With no UPDATE or DELETE policy those commands
-- match no row even for a role that held the grant.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_select" ON "audit_log" AS PERMISSIVE FOR SELECT
  USING ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "tenant_insert" ON "audit_log" AS PERMISSIVE FOR INSERT
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Grants for the runtime role pf_app. No DELETE on the tenant tables (archiving only);
-- audit_log is SELECT and INSERT only. The identity column of audit_log needs no extra grant.
-- ---------------------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON TABLE "obrt_profiles", "customers", "items" TO pf_app;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "audit_log" TO pf_app;--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- audit_log is append-only: the trigger raises for every role, including the table owner.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION public.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- oib_is_registered(text): the cross-tenant "is this OIB taken" check for onboarding. It returns
-- only a boolean. It is owned by pf_definer (NOLOGIN, BYPASSRLS; created in scripts/db/init.sql)
-- because under FORCE RLS a function owned by pf_owner would only see the caller's organization.
-- pf_definer gets column-level SELECT on obrt_profiles(oib) and nothing else.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION public.oib_is_registered(p_oib text) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.obrt_profiles WHERE oib = p_oib::pg_catalog.bpchar
  )
$$;--> statement-breakpoint

-- Execute rights are set while pf_owner still owns the function: after the transfer pf_owner
-- is no longer the owner, and its REVOKE/GRANT would silently do nothing. The ACL entries
-- survive the ownership change.
REVOKE EXECUTE ON FUNCTION public.oib_is_registered(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.oib_is_registered(text) TO pf_app;--> statement-breakpoint

-- Ownership transfer: the new owner needs CREATE on the schema while the transfer happens.
-- Ownership survives the revoke.
GRANT CREATE ON SCHEMA public TO pf_definer;--> statement-breakpoint
ALTER FUNCTION public.oib_is_registered(text) OWNER TO pf_definer;--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM pf_definer;--> statement-breakpoint

GRANT SELECT ("oib") ON TABLE "obrt_profiles" TO pf_definer;
