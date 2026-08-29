-- Partial indexes: Prisma cannot express a WHERE clause on an index, and its
-- migration diff ignores them entirely, so raw SQL is both necessary and safe
-- here. Unlike 002, these must NOT go in schema.prisma.

-- At most one default address per user. A partial unique index enforces this
-- in the database; application code cannot be trusted to hold the invariant.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user_idx
  ON addresses (user_id) WHERE is_default;

-- Live sessions only: the refresh lookup never scans revoked rows.
CREATE INDEX IF NOT EXISTS user_sessions_active_idx
  ON user_sessions (user_id) WHERE revoked_at IS NULL;

-- Unused reset tokens only.
CREATE INDEX IF NOT EXISTS password_reset_tokens_active_idx
  ON password_reset_tokens (user_id) WHERE used_at IS NULL;
