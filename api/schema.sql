-- Schema for the Qur'ān Daily Tracker accounts.
--
-- Deliberately small: an account exists to carry the reading log between
-- devices and to know where to send a reminder. Nothing else is stored.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  start_date    TEXT,                       -- cycle start, YYYY-MM-DD
  timezone      TEXT NOT NULL DEFAULT 'UTC',-- so "today" means their today
  remind_hour   INTEGER NOT NULL DEFAULT 20,-- local hour to nudge at
  email_opt_in  INTEGER NOT NULL DEFAULT 1,
  push_opt_in   INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

-- Sign-in links. Only a hash is kept, so the table is useless if leaked.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX IF NOT EXISTS login_tokens_expiry ON login_tokens (expires_at);

-- Sessions, likewise stored only as a hash.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

-- One row per day read. Absence means not read.
CREATE TABLE IF NOT EXISTS readings (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      TEXT NOT NULL,                   -- YYYY-MM-DD in the user's zone
  juz      INTEGER,
  read_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,             -- hash of the endpoint
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_user ON push_subscriptions (user_id);

-- Guarantees at most one nudge per person per day, even if the cron overlaps.
CREATE TABLE IF NOT EXISTS reminders_sent (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      TEXT NOT NULL,
  sent_at  INTEGER NOT NULL,
  channels TEXT,
  PRIMARY KEY (user_id, day)
);
