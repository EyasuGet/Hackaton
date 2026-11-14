-- Identity (T3-004-A). Roles and course grants are stored only here; requests
-- never supply them.
CREATE TABLE principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('learner', 'support')),
  label text NOT NULL,
  is_demo boolean NOT NULL,
  -- Stable fixture name; present exactly for synthetic demo principals.
  demo_key text UNIQUE CHECK (is_demo = (demo_key IS NOT NULL)),
  -- SHA-256 hex of a demo bearer token; the token itself is never stored, and
  -- only demo principals may hold one.
  token_digest text UNIQUE CHECK (is_demo OR token_digest IS NULL)
);

CREATE TABLE course_grants (
  principal_id uuid NOT NULL REFERENCES principals (id) ON DELETE CASCADE,
  course_id text NOT NULL,
  PRIMARY KEY (principal_id, course_id)
);
