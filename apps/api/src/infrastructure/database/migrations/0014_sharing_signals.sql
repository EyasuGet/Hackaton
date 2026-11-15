-- Signalling message exchange table for WebRTC session negotiation (T3-018-B).
-- Ephemeral signalling messages between authorised session participants.
-- Deleted automatically when the sharing session is deleted (CASCADE).

CREATE TABLE sharing_signals (
  id          bigserial   PRIMARY KEY,
  session_id  uuid        NOT NULL REFERENCES sharing_sessions(id) ON DELETE CASCADE,
  sender_id   uuid        NOT NULL REFERENCES principals(id),
  type        text        NOT NULL CHECK (type IN ('offer', 'answer', 'ice-candidate')),
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sharing_signals_session_idx ON sharing_signals(session_id, id);
