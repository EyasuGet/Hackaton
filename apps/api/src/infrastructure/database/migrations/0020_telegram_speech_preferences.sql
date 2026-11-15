-- Telegram speech audio preference (T3-013-B).
-- Tracks optional automatic speech synthesis for Telegram tutor answers.
-- Preserves bandwidth and data safety by defaulting speech_enabled to false.

ALTER TABLE telegram_identities
  ADD COLUMN IF NOT EXISTS speech_enabled boolean NOT NULL DEFAULT false;
