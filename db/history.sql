PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS history_matches (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  match_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  segments_json TEXT NOT NULL,
  submissions_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_members (
  match_id TEXT NOT NULL REFERENCES history_matches(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('A', 'B')),
  PRIMARY KEY(match_id, participant_id)
);
CREATE INDEX IF NOT EXISTS history_by_owner ON history_members(owner_id, match_id);
CREATE INDEX IF NOT EXISTS history_by_date ON history_matches(ended_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS guest_claims (
  guest_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_sessions (
  credential_hash TEXT PRIMARY KEY,
  guest_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_session_expiry ON guest_sessions(expires_at);
PRAGMA user_version = 1;
