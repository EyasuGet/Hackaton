-- Worker claims and leases (T3-014-B): allow background workers to claim due
-- delivery work with time-bounded leases, recovering abandoned leases after a
-- crash without concurrent workers owning the same claim. No message content
-- or contact details are stored.

ALTER TABLE delivery_intents
  DROP CONSTRAINT IF EXISTS delivery_intents_status_check;

ALTER TABLE delivery_intents
  ADD CONSTRAINT delivery_intents_status_check
  CHECK (status IN ('pending', 'leased', 'completed', 'failed', 'uncertain', 'cancelled'));

ALTER TABLE delivery_intents
  ADD COLUMN claimed_by text,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN completed_at timestamptz;

ALTER TABLE delivery_intents
  DROP CONSTRAINT IF EXISTS delivery_intents_check;

ALTER TABLE delivery_intents
  ADD CONSTRAINT delivery_intents_content_ref_check
  CHECK (content_ref IS NOT NULL OR status IN ('cancelled', 'completed', 'failed', 'uncertain'));

-- Fast scan for due work (pending intents or expired leases) in FIFO order.
CREATE INDEX delivery_intents_due_work_idx
  ON delivery_intents (created_at ASC)
  WHERE status IN ('pending', 'leased');
