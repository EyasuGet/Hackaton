-- Accommodation request statuses and coordinator replies (T3-022-B).
-- Extends accommodation_requests with 'reviewing', 'confirmed', and 'declined' states,
-- plus coordinator review metadata (reviewed_at, reviewed_by).
-- Adds accommodation_request_replies for two-sided learner-coordinator communication.

ALTER TABLE accommodation_requests
  DROP CONSTRAINT accommodation_requests_state_check;

ALTER TABLE accommodation_requests
  ADD CONSTRAINT accommodation_requests_state_check
    CHECK (state IN ('waiting', 'reviewing', 'confirmed', 'declined', 'cancelled'));

ALTER TABLE accommodation_requests
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES principals (id) ON DELETE SET NULL;

CREATE TABLE accommodation_request_replies (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  accommodation_request_id  uuid        NOT NULL REFERENCES accommodation_requests (id) ON DELETE CASCADE,
  author_id                 uuid        NOT NULL REFERENCES principals (id),
  client_reply_id           text        NOT NULL,
  body                      text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  read_at                   timestamptz,
  CONSTRAINT accommodation_request_replies_unique UNIQUE (accommodation_request_id, client_reply_id)
);

CREATE INDEX accommodation_request_replies_request_idx
  ON accommodation_request_replies (accommodation_request_id, created_at ASC);

CREATE INDEX accommodation_requests_state_created_idx
  ON accommodation_requests (state, created_at DESC);
