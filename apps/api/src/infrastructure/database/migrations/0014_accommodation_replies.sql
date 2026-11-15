-- Accommodation request replies, claiming, and resolution (T3-022-B).
-- Adds the accommodation_request_replies table for the coordinator/learner conversation,
-- and extends accommodation_requests with claim and resolution columns plus 'claimed' and 'resolved' states.

-- Add claim and resolution columns to accommodation_requests.
ALTER TABLE accommodation_requests
  ADD COLUMN claimed_by   uuid REFERENCES principals (id) ON DELETE SET NULL,
  ADD COLUMN claimed_at   timestamptz,
  ADD COLUMN resolved_at  timestamptz,
  ADD COLUMN resolved_by  uuid REFERENCES principals (id) ON DELETE SET NULL;

-- Extend the allowed states to include 'claimed' and 'resolved'.
ALTER TABLE accommodation_requests
  DROP CONSTRAINT accommodation_requests_state_check;

ALTER TABLE accommodation_requests
  ADD CONSTRAINT accommodation_requests_state_check
    CHECK (state IN ('waiting', 'cancelled', 'claimed', 'resolved'));

-- Table for replies exchanged between coordinator (support role) and requesting learner.
CREATE TABLE accommodation_request_replies (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_request_id    uuid        NOT NULL REFERENCES accommodation_requests (id) ON DELETE CASCADE,
  author_id                   uuid        NOT NULL REFERENCES principals (id),
  -- Caller-supplied idempotency key; unique per request so retries do not duplicate.
  client_reply_id             text        NOT NULL,
  body                        text        NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  read_at                     timestamptz,
  CONSTRAINT accommodation_request_replies_unique UNIQUE (accommodation_request_id, client_reply_id)
);

-- Fast chronological lookup for a single request's reply thread.
CREATE INDEX accommodation_request_replies_request_idx
  ON accommodation_request_replies (accommodation_request_id, created_at ASC);

-- Index for waiting requests ordered by age.
CREATE INDEX accommodation_requests_state_created_idx
  ON accommodation_requests (state, created_at ASC)
  WHERE state = 'waiting';
