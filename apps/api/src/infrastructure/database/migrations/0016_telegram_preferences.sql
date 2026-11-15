-- Telegram learner preferences and course selection (T3-012-B).
-- Tracks external AI processing consent and active course choice per linked Telegram identity.
-- Preserves privacy by defaulting external_consent to false (approved FAQ mode).

ALTER TABLE telegram_identities
  ADD COLUMN IF NOT EXISTS external_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_course_id text;
