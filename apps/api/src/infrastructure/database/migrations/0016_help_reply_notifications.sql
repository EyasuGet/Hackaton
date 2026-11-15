-- Help reply notification preferences and suppression (T3-017-C).
-- Records explicit learner opt-in for support reply notifications.
-- Pending delivery intents for unlinked/opted-out/cancelled requests are suppressed.

CREATE TABLE help_notification_preferences (
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  channel text NOT NULL,
  opted_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, channel)
);

CREATE INDEX idx_help_notification_preferences_learner
  ON help_notification_preferences (learner_id, channel);

CREATE INDEX IF NOT EXISTS idx_delivery_intents_recipient_channel_pending
  ON delivery_intents (recipient_id, channel)
  WHERE status = 'pending';
