-- Delivery intents (T3-014-A): work to notify someone, committed in the same
-- transaction as the action that requires it. Rows hold no message text or
-- contact details: only an opaque reference to the content (removed when that
-- content expires, see docs/retention.md) and a digest of the logical
-- deduplication key. Claiming, retries and provider states come in T3-014-B/C.
CREATE TABLE delivery_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 hex of the caller's logical key; one intent per logical delivery.
  dedup_digest text NOT NULL UNIQUE,
  recipient_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cancelled')),
  -- Opaque reference to the content to deliver; NULL once that content expired.
  content_ref text,
  -- Never later than the referenced content's own expiry.
  content_expires_at timestamptz NOT NULL,
  -- Bounds how long the non-content dedup record is kept.
  dedup_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (content_ref IS NOT NULL OR status = 'cancelled')
);
