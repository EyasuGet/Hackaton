-- Telegram Identity Linking and Revocation (T3-012-A).
-- Links a private Telegram user account to an authenticated learner.
-- Link codes are single-use, short-lived, stored only as SHA-256 digests.
-- Numeric Telegram user IDs establish identity; usernames and unapproved group chats never establish learner access.

CREATE TABLE telegram_link_codes (
  code_digest text PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_link_codes_learner ON telegram_link_codes (learner_id);

CREATE TABLE telegram_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL,
  telegram_chat_id text NOT NULL,
  telegram_username text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- At most one active Telegram link per learner.
CREATE UNIQUE INDEX idx_telegram_identities_active_learner
  ON telegram_identities (learner_id)
  WHERE revoked_at IS NULL;

-- At most one active learner link per Telegram user (prevents cross-user linking).
CREATE UNIQUE INDEX idx_telegram_identities_active_user
  ON telegram_identities (telegram_user_id)
  WHERE revoked_at IS NULL;

-- Fast active link lookup by Telegram user ID.
CREATE INDEX idx_telegram_identities_lookup
  ON telegram_identities (telegram_user_id)
  WHERE revoked_at IS NULL;
