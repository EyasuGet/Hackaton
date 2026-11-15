-- Help request replies and resolution (T3-017-B).
-- Adds the help_request_replies table for the two-sided staff/learner conversation,
-- and extends help_requests with resolved_at/resolved_by plus the 'resolved' state.

CREATE TABLE help_request_replies (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  help_request_id  uuid        NOT NULL REFERENCES help_requests (id) ON DELETE CASCADE,
  author_id        uuid        NOT NULL REFERENCES principals (id),
  -- Caller-supplied idempotency key; unique per request so retries do not duplicate.
  client_reply_id  text        NOT NULL,
  body             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  CONSTRAINT help_request_replies_unique UNIQUE (help_request_id, client_reply_id)
);

-- Fast chronological lookup for a single request's reply thread.
CREATE INDEX help_request_replies_request_idx
  ON help_request_replies (help_request_id, created_at ASC);

-- Resolution metadata columns for help_requests.
ALTER TABLE help_requests
  ADD COLUMN resolved_at  timestamptz,
  ADD COLUMN resolved_by  uuid REFERENCES principals (id) ON DELETE SET NULL;

-- Extend the allowed states to include 'resolved'.
ALTER TABLE help_requests
  DROP CONSTRAINT help_requests_state_check;

ALTER TABLE help_requests
  ADD CONSTRAINT help_requests_state_check
    CHECK (state IN ('waiting', 'cancelled', 'claimed', 'resolved'));
