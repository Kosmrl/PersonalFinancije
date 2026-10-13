-- Runtime grants for the Better Auth tables (plan: "Database roles", Grants). The auth tables
-- have no row-level security; pf_app (NOSUPERUSER NOBYPASSRLS, owns nothing) gets plain DML.
-- Grants for the tenant tables arrive with the step 5 migration.
-- No default privileges are used on purpose: every table is granted explicitly.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "user", "session", "account", "verification",
  "organization", "member", "invitation",
  "two_factor", "rate_limit"
TO pf_app;
