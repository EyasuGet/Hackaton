-- Help requests (T3-016-A). Learner-owned asynchronous help requests with
-- explicit context-sharing consent. Requests expire after 7 days (T3-023-A
-- retention policy). The (owner_id, client_request_id) unique constraint makes
-- duplicate submissions idempotent at the database level.

CREATE TABLE help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  -- Caller-supplied idempotency key; unique per owner so repeated clicks produce one row.
  client_request_id text NOT NULL,
  -- Freeform context the learner explicitly chose to share after seeing the disclosure.
  context_snapshot text NOT NULL,
  -- Explicit consent gate: set only after the learner confirms the disclosure.
  consent_given boolean NOT NULL DEFAULT false,
  -- waiting = awaiting staff; cancelled = learner cancelled before assignment.
  state text NOT NULL DEFAULT 'waiting'
    CHECK (state IN ('waiting', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 7-day expiry anchored at creation time (T3-023-A, strictest anchor).
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT help_requests_owner_client_id_unique UNIQUE (owner_id, client_request_id)
);

CREATE INDEX help_requests_owner_state_idx
  ON help_requests (owner_id, state, created_at DESC);
