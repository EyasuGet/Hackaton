-- Default a 7-day expiry for new tutoring rows (T3-023-B follow-up, T3-052).
-- These statements were first added by editing 0008 after it had been applied
-- (6721457); 0008 is restored and the change lives here instead. SET DEFAULT is
-- idempotent, so databases that ran the edited 0008 are unaffected.
ALTER TABLE tutoring_conversations ALTER COLUMN expires_at SET DEFAULT now() + INTERVAL '7 days';
ALTER TABLE tutoring_requests ALTER COLUMN expires_at SET DEFAULT now() + INTERVAL '7 days';
