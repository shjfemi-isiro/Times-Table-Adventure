-- Game history and per-fact learning progress.

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY,                -- made on the device, so re-sends are harmless
  family_id          uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id           uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  device_id          uuid,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NOT NULL,
  bridge             text NOT NULL CHECK (bridge IN ('tower','golden-gate','london','third-mainland','6th-october')),
  age_band           text NOT NULL CHECK (age_band IN ('little','builders','masters')),
  answered           smallint NOT NULL CHECK (answered BETWEEN 0 AND 40),
  first_try_correct  smallint NOT NULL CHECK (first_try_correct BETWEEN 0 AND 40),
  stars              smallint NOT NULL CHECK (stars BETWEEN 0 AND 3),
  learning_points    smallint NOT NULL DEFAULT 0,
  facts_improved     smallint NOT NULL DEFAULT 0,
  facts_mastered     smallint NOT NULL DEFAULT 0,
  flagged            boolean NOT NULL DEFAULT false,
  items              jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);
CREATE INDEX sessions_child_idx ON sessions(child_id, started_at DESC);
CREATE INDEX sessions_family_idx ON sessions(family_id, started_at DESC);
CREATE INDEX sessions_started_idx ON sessions(started_at);

CREATE TABLE fact_progress (
  child_id     uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  a            smallint NOT NULL CHECK (a BETWEEN 0 AND 12),
  b            smallint NOT NULL CHECK (b BETWEEN 0 AND 12),
  box          smallint NOT NULL DEFAULT 0,
  streak       smallint NOT NULL DEFAULT 0,
  seen         integer NOT NULL DEFAULT 0,
  correct      integer NOT NULL DEFAULT 0,
  best_ms      integer,
  mastered_at  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, a, b)
);
CREATE INDEX fact_progress_family_idx ON fact_progress(family_id);
