-- Phone-ownership verification challenges and verified learner phones (T3-003-E, T3-021-A).
-- Plaintext OTP is NEVER stored. Only salted SHA-256 digests are persisted.
-- Verified phone bindings are strictly scoped to the authenticated learner.

CREATE TABLE phone_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  code_digest text NOT NULL,
  salt text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
);

CREATE INDEX idx_phone_verification_codes_phone_created ON phone_verification_codes (phone_number, created_at DESC);
CREATE INDEX idx_phone_verification_codes_learner ON phone_verification_codes (learner_id, phone_number);

CREATE TABLE learner_verified_phones (
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, phone_number)
);

CREATE INDEX idx_learner_verified_phones_learner ON learner_verified_phones (learner_id);
