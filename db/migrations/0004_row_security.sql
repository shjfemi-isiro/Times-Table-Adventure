-- Defence in depth: API requests run as tta_app with the caller's family id set
-- for the transaction, so a query that forgets its WHERE clause still cannot read
-- another family. Scheduled jobs run as the owner role, which bypasses RLS
-- because RLS is ENABLED, not FORCED.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tta_app') THEN
    CREATE ROLE tta_app NOLOGIN;
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE format('GRANT tta_app TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not grant tta_app to %: %', current_user, SQLERRM;
END $$;

CREATE FUNCTION app_family() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.family_id', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA public TO tta_app;
GRANT EXECUTE ON FUNCTION app_family() TO tta_app;

GRANT SELECT, UPDATE ON families TO tta_app;
GRANT SELECT ON family_members TO tta_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON children TO tta_app;
GRANT SELECT, INSERT ON consents TO tta_app;
GRANT SELECT ON consent_state TO tta_app;
GRANT USAGE ON SEQUENCE consents_id_seq TO tta_app;
GRANT SELECT, INSERT, UPDATE ON devices TO tta_app;
GRANT SELECT, INSERT ON complaints TO tta_app;
GRANT SELECT, INSERT ON audit_log TO tta_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO tta_app;
GRANT SELECT ON sessions, fact_progress, weekly_points, child_tiers, league_members, rewards TO tta_app;
GRANT SELECT ON leagues TO tta_app;

ALTER TABLE families        ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE children        ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_progress   ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_points   ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_tiers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards         ENABLE ROW LEVEL SECURITY;

CREATE POLICY own_family ON families       TO tta_app USING (id = app_family()) WITH CHECK (id = app_family());
CREATE POLICY own_family ON family_members TO tta_app USING (family_id = app_family());
CREATE POLICY own_family ON children       TO tta_app USING (family_id = app_family()) WITH CHECK (family_id = app_family());
CREATE POLICY own_family ON consents       TO tta_app USING (family_id = app_family()) WITH CHECK (family_id = app_family());
CREATE POLICY own_family ON devices        TO tta_app USING (family_id = app_family()) WITH CHECK (family_id = app_family());
CREATE POLICY own_family ON complaints     TO tta_app USING (family_id = app_family()) WITH CHECK (family_id = app_family());
CREATE POLICY own_family ON audit_log      TO tta_app USING (family_id = app_family()) WITH CHECK (family_id = app_family());
CREATE POLICY own_family ON sessions       TO tta_app USING (family_id = app_family());
CREATE POLICY own_family ON fact_progress  TO tta_app USING (family_id = app_family());
CREATE POLICY own_family ON weekly_points  TO tta_app USING (family_id = app_family());
CREATE POLICY own_family ON child_tiers    TO tta_app USING (family_id = app_family());
CREATE POLICY own_family ON league_members TO tta_app USING (family_id = app_family());
CREATE POLICY own_family ON rewards        TO tta_app USING (family_id = app_family());
