-- Weekly learning leagues and cosmetic rewards. Points come from learning, not speed.

CREATE TABLE weekly_points (
  child_id        uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  family_id       uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  week            date NOT NULL,                    -- Monday (UTC) of the ISO week
  points          integer NOT NULL DEFAULT 0,
  facts_improved  integer NOT NULL DEFAULT 0,
  facts_mastered  integer NOT NULL DEFAULT 0,
  sessions        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, week)
);
CREATE INDEX weekly_points_week_idx ON weekly_points(week);

CREATE TABLE child_tiers (
  child_id    uuid PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  tier        smallint NOT NULL DEFAULT 1 CHECK (tier BETWEEN 1 AND 5),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE leagues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week        date NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('global','country')),
  country     char(2),
  age_band    text NOT NULL CHECK (age_band IN ('builders','masters')),
  tier        smallint NOT NULL CHECK (tier BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'country') = (country IS NOT NULL))
);
CREATE INDEX leagues_week_idx ON leagues(week);

CREATE TABLE league_members (
  league_id  uuid NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  child_id   uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  points     integer NOT NULL,
  rank       smallint NOT NULL,
  outcome    text NOT NULL CHECK (outcome IN ('promoted','stayed')),
  PRIMARY KEY (league_id, child_id)
);
CREATE INDEX league_members_child_idx ON league_members(child_id);

CREATE TABLE rewards (
  id         bigserial PRIMARY KEY,
  child_id   uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  family_id  uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('paint','sticker','badge')),
  code       text NOT NULL CHECK (code ~ '^[a-z0-9-]{2,40}$'),
  reason     text NOT NULL,
  earned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (child_id, kind, code)
);
