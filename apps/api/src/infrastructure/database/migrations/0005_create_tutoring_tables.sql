-- Tutoring persistence (T3-007-D). Owned conversations and requests for
-- grounded tutoring. Requests are claimed atomically by (owner_id, request_id)
-- so retries and concurrent submissions never produce duplicate messages
-- or cross-user collisions.

CREATE TABLE tutoring_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  course_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tutoring_conversations_owner_idx
  ON tutoring_conversations (owner_id, course_id, updated_at DESC);

CREATE TABLE tutoring_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES tutoring_conversations (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  course_id text NOT NULL,
  request_id text NOT NULL,
  question text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'completed', 'recoverable_failure')),
  answer_text text,
  answer_lang text,
  error_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT tutoring_requests_owner_request_id_unique UNIQUE (owner_id, request_id)
);

CREATE INDEX tutoring_requests_conversation_idx
  ON tutoring_requests (conversation_id, created_at ASC);

CREATE INDEX tutoring_requests_owner_idx
  ON tutoring_requests (owner_id, course_id, created_at DESC);
