-- Signalling session table for screen-sharing access control (T3-018-A).
-- A session binds exactly one help request to the two authorised participants
-- (learner and the support person who claimed the request).
-- Only one active session may exist per help request (UNIQUE constraint).

CREATE TABLE sharing_sessions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  help_request_id  uuid        NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
  learner_id       uuid        NOT NULL REFERENCES principals(id),
  support_id       uuid        NOT NULL REFERENCES principals(id),
  state            text        NOT NULL DEFAULT 'pending'
                               CHECK (state IN ('pending', 'active', 'revoked', 'expired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  revoked_at       timestamptz,
  CONSTRAINT sharing_sessions_per_request_unique UNIQUE (help_request_id)
);
