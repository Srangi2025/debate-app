-- Private backend-only schema: browser Supabase clients must not access these records.
BEGIN;
SELECT pg_advisory_xact_lock(736284109);
CREATE SCHEMA IF NOT EXISTS ranked_debate;
REVOKE ALL ON SCHEMA ranked_debate FROM PUBLIC;
CREATE TABLE IF NOT EXISTS ranked_debate.history_matches (
  id TEXT PRIMARY KEY,
  created_at BIGINT NOT NULL,
  ended_at BIGINT NOT NULL,
  snapshot JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS ranked_debate.history_members (
  match_id TEXT NOT NULL REFERENCES ranked_debate.history_matches(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('A','B')),
  PRIMARY KEY(match_id,participant_id)
);
CREATE INDEX IF NOT EXISTS history_by_owner ON ranked_debate.history_members(owner_id,match_id);
CREATE INDEX IF NOT EXISTS history_by_date ON ranked_debate.history_matches(ended_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS ranked_debate.guest_claims (guest_id TEXT PRIMARY KEY,account_id TEXT NOT NULL,claimed_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS ranked_debate.profiles (user_id TEXT PRIMARY KEY,username TEXT NOT NULL,updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS ranked_debate.guest_sessions (credential_hash TEXT PRIMARY KEY,guest_id TEXT NOT NULL,expires_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS guest_session_expiry ON ranked_debate.guest_sessions(expires_at);
REVOKE ALL ON ALL TABLES IN SCHEMA ranked_debate FROM PUBLIC;
ALTER TABLE ranked_debate.history_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_debate.history_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_debate.guest_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_debate.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranked_debate.guest_sessions ENABLE ROW LEVEL SECURITY;
-- Supabase grants browser roles by default in public; explicitly deny them here too.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA ranked_debate FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA ranked_debate FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA ranked_debate FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA ranked_debate FROM authenticated;
  END IF;
END $$;
COMMIT;
