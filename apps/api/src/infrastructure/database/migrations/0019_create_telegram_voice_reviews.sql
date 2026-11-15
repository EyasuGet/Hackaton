-- Persists pending Telegram voice review requests and transcript approvals (T3-013-A).
-- Grants learners explicit review and editing control over audio transcripts
-- before asking tutoring questions.

CREATE TABLE IF NOT EXISTS telegram_voice_reviews (
  id uuid PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  telegram_user_id text NOT NULL,
  telegram_chat_id text NOT NULL,
  course_id text NOT NULL,
  transcript text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'discarded', 'awaiting_edit')),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_voice_reviews_user_status
  ON telegram_voice_reviews(telegram_user_id, status);

CREATE INDEX IF NOT EXISTS idx_telegram_voice_reviews_expires_at
  ON telegram_voice_reviews(expires_at);
