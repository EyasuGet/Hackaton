-- Private Telegram identities and linking tokens (T3-012-A).
-- Maps authenticated learner principals to private Telegram accounts.
-- Tokens are stored as SHA-256 digests; raw tokens never appear in database storage or logs.
-- Usernames and unapproved group chats never establish learner access.

CREATE TABLE telegram_linking_tokens (
  token_digest text PRIMARY KEY,
  principal_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_linking_tokens_principal ON telegram_linking_tokens (principal_id);

CREATE TABLE telegram_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL,
  chat_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT uq_telegram_identities_principal_user UNIQUE (principal_id, telegram_user_id)
);

CREATE UNIQUE INDEX idx_telegram_identities_active_principal
  ON telegram_identities (principal_id)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX idx_telegram_identities_active_telegram_user
  ON telegram_identities (telegram_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX idx_telegram_identities_user_id ON telegram_identities (telegram_user_id);
