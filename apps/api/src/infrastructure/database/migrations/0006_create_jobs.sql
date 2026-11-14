-- Approved career opportunities (T3-019-A). Each imported job maintains a stable
-- ID, an immutable publication event identifier, and versioned revisions.
-- Only the current_version_id is authoritative; expired and withdrawn statuses
-- are queryable against the current version.

CREATE TABLE jobs (
  id text PRIMARY KEY,
  current_version_id uuid,
  publication_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL REFERENCES jobs (id),
  version text NOT NULL,
  checksum text NOT NULL,
  title text NOT NULL,
  organization text NOT NULL,
  category text NOT NULL,
  location text NOT NULL,
  description text NOT NULL,
  source_url text NOT NULL,
  posted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  withdrawn boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL,
  provenance jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);

ALTER TABLE jobs
  ADD FOREIGN KEY (current_version_id) REFERENCES job_versions (id);

CREATE INDEX idx_job_versions_category ON job_versions (category);
CREATE INDEX idx_job_versions_location ON job_versions (location);
CREATE INDEX idx_job_versions_expires_at ON job_versions (expires_at);
