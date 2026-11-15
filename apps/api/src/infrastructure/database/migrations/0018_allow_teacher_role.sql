-- Allow 'teacher' role in principals table (T3-030).
-- Permits authorized course teachers to authenticate and access aggregate course analytics.
ALTER TABLE principals DROP CONSTRAINT IF EXISTS principals_role_check;
ALTER TABLE principals ADD CONSTRAINT principals_role_check CHECK (role IN ('learner', 'support', 'teacher'));
