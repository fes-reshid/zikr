-- Schema for the Qur'ān Daily Tracker reminders.
--
-- Accounts live in Firebase, shared with the quest games, so nothing
-- identifying is stored here: no email, no username, no display name. The only
-- link to a person is `uid`, the opaque Firebase user id, and it is kept purely
-- so the nightly job knows who has not read today and where to send a push.
--
-- The reading log people actually see is synced through Firestore by the page,
-- alongside the other apps' progress. What is mirrored here is only what the
-- scheduled job has to be able to read without a browser present.

CREATE TABLE IF NOT EXISTS reminder_settings (
  uid          TEXT PRIMARY KEY,           -- Firebase uid, nothing else
  start_date   TEXT,                       -- cycle start, YYYY-MM-DD
  timezone     TEXT NOT NULL DEFAULT 'UTC',-- so "today" means their today
  remind_hour  INTEGER NOT NULL DEFAULT 20,
  push_opt_in  INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS readings (
  uid      TEXT NOT NULL,
  day      TEXT NOT NULL,                  -- YYYY-MM-DD in the user's zone
  read_at  INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          TEXT PRIMARY KEY,            -- hash of the endpoint
  uid         TEXT NOT NULL,
  endpoint    TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_uid ON push_subscriptions (uid);

-- Guarantees at most one nudge per person per day, even if runs overlap.
CREATE TABLE IF NOT EXISTS reminders_sent (
  uid      TEXT NOT NULL,
  day      TEXT NOT NULL,
  sent_at  INTEGER NOT NULL,
  PRIMARY KEY (uid, day)
);
