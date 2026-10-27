CREATE TABLE IF NOT EXISTS faqs (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,
  question    TEXT NOT NULL UNIQUE,
  answer      TEXT NOT NULL,
  keywords    TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS error_codes (
  code         TEXT PRIMARY KEY,
  http_status  INTEGER NOT NULL,
  title        TEXT NOT NULL,
  meaning      TEXT NOT NULL,
  user_action  TEXT NOT NULL,
  site_specific BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tickets (
  id          SERIAL PRIMARY KEY,
  reference   TEXT NOT NULL UNIQUE,
  name        TEXT,
  email       TEXT,
  subject     TEXT NOT NULL,
  message     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'form',
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  session_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
