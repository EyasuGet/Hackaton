-- Adds claim columns to help_requests and extends the state enum (T3-017-A).
-- Staff claim a waiting request atomically; a claimed request is locked to one
-- staff member and cannot be double-assigned.

ALTER TABLE help_requests
  ADD COLUMN claimed_by  uuid REFERENCES principals (id) ON DELETE SET NULL,
  ADD COLUMN claimed_at  timestamptz;

-- Extend the allowed states to include 'claimed'.
ALTER TABLE help_requests
  DROP CONSTRAINT help_requests_state_check;

ALTER TABLE help_requests
  ADD CONSTRAINT help_requests_state_check
    CHECK (state IN ('waiting', 'cancelled', 'claimed'));

-- Fast lookup for the support queue: all waiting requests ordered by age.
CREATE INDEX help_requests_state_created_idx
  ON help_requests (state, created_at ASC)
  WHERE state = 'waiting';
