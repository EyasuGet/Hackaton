-- Track processed Telegram updates for replay prevention and idempotency (T3-019-C).
-- Duplicate incoming update IDs return the recorded response without duplicating side effects.

CREATE TABLE telegram_processed_updates (
  update_id bigint PRIMARY KEY,
  telegram_user_id text,
  response_status text NOT NULL,
  response_payload jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_telegram_processed_updates_user
  ON telegram_processed_updates (telegram_user_id);
