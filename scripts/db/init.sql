-- Local/dev/test bootstrap, applied by scripts/db/embedded.ts (applyInitSql) as the cluster
-- superuser on EVERY start of `npm run db` and of the integration-test instance. Everything
-- here is idempotent, so an interrupted run is repaired by the next one, and an existing
-- cluster picks up additions (such as pf_definer) automatically.
-- Build-sequence step 2 of docs/plans/2026-10-09-phase-1-foundation.md ("Database roles").
--
-- Roles
--   pf_owner    owns the databases and every table; runs migrations (DATABASE_MIGRATION_URL).
--   pf_app      runtime role (DATABASE_URL): NOSUPERUSER NOBYPASSRLS, owns nothing, so row-level
--               security always applies to it. Table grants come from the custom migration (step 5).
--   pf_definer  NOLOGIN, BYPASSRLS, granted to pf_owner. It will own the SECURITY DEFINER
--               functions that must look across tenants (oib_is_registered). Only a superuser
--               can create a BYPASSRLS role, so it has to live here and not in a migration.
--
-- Passwords are dev/test only. They are never written into this file: the runner passes SCRAM-SHA-256
-- verifiers (computed client-side) as the session settings pf.owner_verifier and
-- pf.app_verifier, so no plaintext password reaches the server or its logs.
--
-- Databases are created by the runner (CREATE DATABASE cannot run inside a DO block): the dev
-- cluster gets pf_dev, the throwaway test instance gets pf_test. The part after the
-- "per-database" marker below runs once for each of them, with the name in pf.database.
-- The runner splits this file at the marker line and sends each part as one query.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pf_owner') THEN
    CREATE ROLE pf_owner;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pf_app') THEN
    CREATE ROLE pf_app;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pf_definer') THEN
    CREATE ROLE pf_definer;
  END IF;

  EXECUTE format(
    'ALTER ROLE pf_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    current_setting('pf.owner_verifier')
  );
  EXECUTE format(
    'ALTER ROLE pf_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    current_setting('pf.app_verifier')
  );
  ALTER ROLE pf_definer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS PASSWORD NULL;

  -- pf_owner may SET ROLE pf_definer (needed for ALTER FUNCTION ... OWNER TO pf_definer) but does
  -- not inherit its privileges, in particular BYPASSRLS does not apply to pf_owner's own
  -- sessions. The explicit options also reset an older grant made with the defaults.
  GRANT pf_definer TO pf_owner WITH INHERIT FALSE, SET TRUE;
  -- pf_app must never belong to pf_definer; this repairs a stray grant.
  REVOKE pf_definer FROM pf_app;
END
$$;

-- The maintenance databases are not for the application roles.
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;

-- per-database
-- Only pf_owner (the database owner) and pf_app may connect. pf_app gets CONNECT and nothing
-- else: no TEMP, no CREATE. The database owner pf_owner can create objects in the public
-- schema (PostgreSQL 15+ no longer lets PUBLIC do that), so pf_app can use but not create
-- tables there.
DO $$
DECLARE
  db text := current_setting('pf.database');
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO pf_owner', db);
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', db);
  -- Reset anything granted to pf_app by hand (CREATE, TEMP) before granting exactly CONNECT.
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM pf_app', db);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pf_app', db);
END
$$;
