-- Allow 'employer' role in principals table (T3-031).
-- Permits verified employer accounts to authenticate and manage vacancies.
ALTER TABLE principals DROP CONSTRAINT IF EXISTS principals_role_check;
ALTER TABLE principals ADD CONSTRAINT principals_role_check CHECK (role IN ('learner', 'support', 'teacher', 'employer'));

-- Create employer vacancies table
CREATE TABLE IF NOT EXISTS employer_vacancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  location VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employer_vacancies_employer ON employer_vacancies(employer_id);

-- Create consented candidate applications table
-- Strict rule: Employers can ONLY view candidate records who explicitly applied
CREATE TABLE IF NOT EXISTS consented_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id UUID NOT NULL REFERENCES employer_vacancies(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  learner_full_name VARCHAR(150) NOT NULL,
  contact_channel VARCHAR(100) NOT NULL,
  resume_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'interview_scheduled', 'closed')),
  consented_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_learner_vacancy UNIQUE (vacancy_id, learner_id)
);

CREATE INDEX IF NOT EXISTS idx_consented_applications_vacancy ON consented_applications(vacancy_id);
