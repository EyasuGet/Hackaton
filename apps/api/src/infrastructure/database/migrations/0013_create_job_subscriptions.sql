-- Job alert subscriptions and contact destinations (T3-020-A).
-- Learner-owned category and location preferences for channel-neutral job alerts.
-- Contacts are retained only while needed by an active subscription (docs/retention.md).

CREATE TABLE job_alert_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  channel text NOT NULL,
  destination text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (learner_id, channel)
);

CREATE TABLE job_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  channel text NOT NULL,
  contact_id uuid REFERENCES job_alert_contacts (id) ON DELETE SET NULL,
  categories text[] NOT NULL DEFAULT '{}',
  locations text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  unsubscribed_at timestamptz
);

CREATE INDEX idx_job_subscriptions_active ON job_subscriptions (active) WHERE active = true;
CREATE INDEX idx_job_subscriptions_learner ON job_subscriptions (learner_id);
CREATE INDEX idx_job_alert_contacts_learner ON job_alert_contacts (learner_id);
