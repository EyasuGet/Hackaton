-- Tutoring expiry and purge support (T3-023-B). Adds expiry and purge timestamps
-- to conversations and requests. Expiry is set to created_at + 7 days per the
-- T3-023-A policy. purged_at marks rows whose private content has been removed
-- without deleting the row (preserving dedup keys). Existing rows are assigned
-- an expiry based on their existing created_at so the policy applies uniformly.

ALTER TABLE tutoring_conversations
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN purged_at timestamptz;

ALTER TABLE tutoring_requests
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN purged_at timestamptz;

-- Back-fill expiry for rows created before this migration (7-day anchor).
UPDATE tutoring_conversations SET expires_at = created_at + INTERVAL '7 days' WHERE expires_at IS NULL;
UPDATE tutoring_requests SET expires_at = created_at + INTERVAL '7 days' WHERE expires_at IS NULL;

-- Make expires_at NOT NULL now that every row has a value and set 7-day default for new rows.
ALTER TABLE tutoring_conversations ALTER COLUMN expires_at SET DEFAULT now() + INTERVAL '7 days';
ALTER TABLE tutoring_conversations ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE tutoring_requests ALTER COLUMN expires_at SET DEFAULT now() + INTERVAL '7 days';
ALTER TABLE tutoring_requests ALTER COLUMN expires_at SET NOT NULL;

-- Index for efficient expiry sweeps (find rows past their expiry that are not yet purged).
CREATE INDEX tutoring_conversations_expires_idx
  ON tutoring_conversations (expires_at)
  WHERE purged_at IS NULL;

CREATE INDEX tutoring_requests_expires_idx
  ON tutoring_requests (expires_at)
  WHERE purged_at IS NULL;
