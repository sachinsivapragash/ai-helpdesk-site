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

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT NOT NULL,
  venue       TEXT NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  price       INTEGER NOT NULL DEFAULT 0,
  capacity    INTEGER NOT NULL CHECK (capacity > 0),
  booked      INTEGER NOT NULL DEFAULT 0 CHECK (booked >= 0)
);

CREATE TABLE IF NOT EXISTS bookings (
  id          SERIAL PRIMARY KEY,
  reference   TEXT NOT NULL UNIQUE,
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  seats       INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 4),
  status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, email)
);
