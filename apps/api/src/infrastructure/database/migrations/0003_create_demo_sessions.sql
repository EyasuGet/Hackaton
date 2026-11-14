-- Demo sessions (T3-004-C). A handoff code is short-lived and single-use; a
-- session token is short-lived and revocable. Both are stored only as SHA-256
-- digests and belong to demo principals only (checked when they are read).
CREATE TABLE demo_handoffs (
  code_digest text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  -- The page origin the code was minted for; it cannot be spent anywhere else.
  audience text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE demo_sessions (
  token_digest text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
