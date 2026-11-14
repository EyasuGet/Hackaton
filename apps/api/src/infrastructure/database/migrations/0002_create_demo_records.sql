-- FIXTURE ONLY (T3-004-A): synthetic learner-owned records that exercise the
-- identity access rule. Drop this table in a new migration once real learner
-- data, such as tutoring history (T3-007-D), applies the rule.
CREATE TABLE demo_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demo_key text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  course_id text NOT NULL,
  body text NOT NULL
);
