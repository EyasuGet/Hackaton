-- Approved lesson content (T3-005-A). Every import that changes a source adds an
-- immutable version; the source's current_version_id names the only version
-- whose sections are authoritative. Earlier versions stay for inspection and so
-- withdrawn citations can be answered honestly.
CREATE TABLE lesson_sources (
  id text PRIMARY KEY,
  current_version_id uuid
);

CREATE TABLE lesson_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES lesson_sources (id),
  version text NOT NULL,
  checksum text NOT NULL,
  title text NOT NULL,
  course_id text NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'am')),
  -- Distinguishes synthetic demo content from approved organiser material.
  is_demo boolean NOT NULL,
  provenance jsonb NOT NULL,
  withdrawn boolean NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  -- A label names exactly one content version per source.
  UNIQUE (source_id, version)
);

ALTER TABLE lesson_sources
  ADD FOREIGN KEY (current_version_id) REFERENCES lesson_source_versions (id);

CREATE TABLE lesson_sections (
  version_id uuid NOT NULL REFERENCES lesson_source_versions (id),
  section_id text NOT NULL,
  position integer NOT NULL,
  anchor text,
  heading text NOT NULL,
  body text NOT NULL,
  PRIMARY KEY (version_id, section_id),
  UNIQUE (version_id, position)
);
