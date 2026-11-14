-- Accommodation requests (T3-022-A). Learner-owned requests targeting an approved
-- job, with the support description the learner explicitly reviewed and confirmed.
-- Only the owner and an authorised coordinator (support role) may access the content.
-- Requests expire after 7 days (T3-023-A retention policy). The unique
-- (owner_id, client_request_id) constraint makes duplicate submissions idempotent.

CREATE TABLE accommodation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  -- The approved job this request targets; job_id is stable across version updates.
  job_id text NOT NULL REFERENCES jobs (id),
  -- Caller-supplied idempotency key; unique per owner so repeated clicks produce one row.
  client_request_id text NOT NULL,
  -- The support the learner described after reviewing the preview. No diagnosis fields stored.
  support_description text NOT NULL,
  -- waiting = awaiting coordinator handling; cancelled = learner cancelled before handling.
  state text NOT NULL DEFAULT 'waiting'
    CHECK (state IN ('waiting', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 7-day expiry anchored at creation time (T3-023-A, strictest anchor).
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT accommodation_requests_owner_client_id_unique UNIQUE (owner_id, client_request_id)
);

CREATE INDEX accommodation_requests_owner_state_idx
  ON accommodation_requests (owner_id, state, created_at DESC);
