-- Families, children, consent receipts, paired devices, complaints, audit.
-- Data minimisation: no parent email, no child surname, no date of birth.
-- Parents are Clerk users (only the Clerk user id is stored here).

CREATE TABLE families (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   text NOT NULL UNIQUE,
  clerk_org_id    text UNIQUE,
  country         char(2) NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  rules           text NOT NULL CHECK (rules IN ('uk','eu','us','ng','eg','other')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE family_members (
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  role       text NOT NULL CHECK (role IN ('owner','carer')),
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, user_id)
);
CREATE INDEX family_members_user_idx ON family_members(user_id);

CREATE TABLE children (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id       uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  avatar_id       text NOT NULL CHECK (avatar_id ~ '^[a-z0-9-]{2,24}$'),
  display_mode    text NOT NULL DEFAULT 'avatar' CHECK (display_mode IN ('avatar','first_name','game_name')),
  first_name      text CHECK (first_name IS NULL OR char_length(first_name) BETWEEN 1 AND 20),
  game_name_code  text NOT NULL CHECK (game_name_code ~ '^[0-9]{1,3}-[0-9]{1,3}-[0-9]{2}$'),
  age_band        text NOT NULL CHECK (age_band IN ('little','builders','masters')),
  car_color       text CHECK (car_color IS NULL OR car_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT first_name_needs_mode CHECK (display_mode <> 'first_name' OR first_name IS NOT NULL)
);
CREATE INDEX children_family_idx ON children(family_id);

-- Append-only consent receipts. The latest row per (family, child, purpose) wins.
CREATE TABLE consents (
  id              bigserial PRIMARY KEY,
  family_id       uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id        uuid REFERENCES children(id) ON DELETE CASCADE,
  purpose         text NOT NULL CHECK (purpose IN ('core','cloud_sync','family_board','public_leagues','product_emails')),
  granted         boolean NOT NULL,
  method          text NOT NULL CHECK (method IN ('verified_email_session','reverified_session')),
  policy_version  text NOT NULL,
  actor_user_id   text NOT NULL,
  receipt         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_lookup_idx ON consents(family_id, child_id, purpose, id DESC);

CREATE FUNCTION consents_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'consent receipts are append-only';
END $$;
CREATE TRIGGER consents_no_update BEFORE UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION consents_append_only();

CREATE VIEW consent_state WITH (security_invoker = true) AS
  SELECT DISTINCT ON (family_id, child_id, purpose)
         family_id, child_id, purpose, granted, method, policy_version, created_at
    FROM consents
   ORDER BY family_id, child_id, purpose, id DESC;

-- Paired play devices (a family tablet). Tokens are signed; only revocation lives here.
CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id     uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  label         text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_sync_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX devices_family_idx ON devices(family_id);

-- UK Data (Use and Access) Act 2025: data protection complaints procedure.
CREATE TABLE complaints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id        uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('privacy','child_safety','accessibility','other')),
  message          text NOT NULL CHECK (char_length(message) BETWEEN 5 AND 2000),
  status           text NOT NULL DEFAULT 'received' CHECK (status IN ('received','acknowledged','resolved')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz
);

-- No personal data in the audit log: ids and action names only.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  family_id  uuid,
  actor      text NOT NULL,
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_family_idx ON audit_log(family_id, at DESC);
