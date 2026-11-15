// Employer Recruitment Dashboard Component (T3-031).
// Provides recruitment pipeline management strictly isolated from learner personal tutoring and accommodations.
// Rendered only for the employer role (T3-050): other roles cannot use it, and seeing
// "Consented Applicants" would confuse learners.
import { useEffect, useState, type FormEvent } from 'react';
import { T, useT, type MessageKey } from '../../shared/i18n/i18n.tsx';
import { EmployerApi, type ConsentedApplication, type EmployerVacancy } from './employer-api.ts';

interface EmployerDashboardProps {
  readonly sessionToken: string;
}

/** True once the API confirms the signed-in principal has the employer role. */
function useIsEmployer(sessionToken: string): boolean {
  const [isEmployer, setIsEmployer] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setIsEmployer(false);
    fetch('/api/me', {
      headers: { authorization: `Bearer ${sessionToken}` },
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ role?: unknown }>) : null))
      .then((me) => setIsEmployer(me?.role === 'employer'))
      .catch(() => {});
    return () => controller.abort();
  }, [sessionToken]);
  return isEmployer;
}

export function EmployerDashboard({ sessionToken }: EmployerDashboardProps) {
  const isEmployer = useIsEmployer(sessionToken);
  return isEmployer ? <EmployerPortal sessionToken={sessionToken} /> : null;
}

function EmployerPortal({ sessionToken }: EmployerDashboardProps) {
  const t = useT();
  const [api] = useState(() => new EmployerApi(sessionToken));
  const [vacancies, setVacancies] = useState<readonly EmployerVacancy[]>([]);
  const [selectedVacancy, setSelectedVacancy] = useState<EmployerVacancy | null>(null);
  const [applications, setApplications] = useState<readonly ConsentedApplication[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  // New vacancy form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void loadVacancies();
  }, [api]);

  async function loadVacancies() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.listVacancies();
      setVacancies(data);
    } catch {
      setError('employer.errorLoad');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSelectVacancy(vacancy: EmployerVacancy) {
    setSelectedVacancy(vacancy);
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.listApplications(vacancy.id);
      setApplications(data.applications);
      setPrivacyNotice(data.privacyNotice);
    } catch {
      setError('employer.errorApplications');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateVacancy(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('employer.errorRequired');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const created = await api.postVacancy({
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || undefined,
        location: location.trim() || undefined,
      });
      setTitle('');
      setDescription('');
      setCategory('');
      setLocation('');
      setVacancies((prev) => [created, ...prev]);
    } catch {
      setError('employer.errorPost');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="employer-dashboard" data-testid="employer-dashboard">
      <header className="employer-header">
        <h2>
          <T k="employer.heading" />
        </h2>
        <div className="privacy-banner" role="note" aria-label={t('employer.privacyLabel')}>
          <p>
            <strong>
              <T k="employer.privacyTitle" />
            </strong>{' '}
            <T k="employer.privacyBody" />
          </p>
        </div>
      </header>

      {error && (
        <div className="alert-error" role="alert">
          <T k={error} />
        </div>
      )}

      <div className="employer-grid">
        <section className="employer-section" aria-labelledby="post-vacancy-heading">
          <h3 id="post-vacancy-heading">
            <T k="employer.postHeading" />
          </h3>
          <form
            onSubmit={(e) => {
              void handleCreateVacancy(e);
            }}
            className="vacancy-form"
          >
            <div className="form-group">
              <label htmlFor="vacancy-title">
                <T k="employer.titleLabel" />
              </label>
              <input
                id="vacancy-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('employer.titlePlaceholder')}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="vacancy-category">
                <T k="employer.categoryLabel" />
              </label>
              <input
                id="vacancy-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t('employer.categoryPlaceholder')}
              />
            </div>

            <div className="form-group">
              <label htmlFor="vacancy-location">
                <T k="employer.locationLabel" />
              </label>
              <input
                id="vacancy-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('employer.locationPlaceholder')}
              />
            </div>

            <div className="form-group">
              <label htmlFor="vacancy-description">
                <T k="employer.descriptionLabel" />
              </label>
              <textarea
                id="vacancy-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('employer.descriptionPlaceholder')}
                rows={4}
                required
              />
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary">
              <T k={isSubmitting ? 'employer.posting' : 'employer.publish'} />
            </button>
          </form>
        </section>

        <section className="employer-section" aria-labelledby="vacancies-heading">
          <h3 id="vacancies-heading">
            <T k="employer.vacanciesHeading" />
          </h3>
          {isLoading && !selectedVacancy && (
            <p>
              <T k="employer.loadingVacancies" />
            </p>
          )}
          {vacancies.length === 0 && !isLoading ? (
            <p>
              <T k="employer.noVacancies" />
            </p>
          ) : (
            <ul className="vacancy-list" aria-label={t('employer.vacanciesList')}>
              {vacancies.map((v) => (
                <li
                  key={v.id}
                  className={`vacancy-card ${selectedVacancy?.id === v.id ? 'active' : ''}`}
                  onClick={() => {
                    void handleSelectVacancy(v);
                  }}
                >
                  <h4>{v.title}</h4>
                  <div className="vacancy-meta">
                    <span className="badge">{v.category}</span>
                    <span className="location">{v.location}</span>
                    <span className="status">{v.status}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSelectVacancy(v);
                    }}
                  >
                    <T k="employer.viewApplicants" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="employer-section" aria-labelledby="applicants-heading">
          <h3 id="applicants-heading">
            <T k="employer.applicantsHeading" />
          </h3>
          {selectedVacancy ? (
            <div>
              <p className="selected-meta">
                <T k="employer.showingFor" /> <strong>{selectedVacancy.title}</strong>
              </p>
              {privacyNotice && <div className="notice-banner">{privacyNotice}</div>}
              {applications.length === 0 ? (
                <p>
                  <T k="employer.noApplicants" />
                </p>
              ) : (
                <ul className="application-list" aria-label={t('employer.applicationsList')}>
                  {applications.map((app) => (
                    <li key={app.id} className="application-card">
                      <h4>{app.learnerFullName}</h4>
                      <p>
                        <strong>
                          <T k="employer.contact" />
                        </strong>{' '}
                        {app.contactChannel}
                      </p>
                      {app.resumeUrl && (
                        <p>
                          <a href={app.resumeUrl} target="_blank" rel="noopener noreferrer">
                            <T k="employer.viewResume" />
                          </a>
                        </p>
                      )}
                      <p className="meta-text">
                        <T k="employer.consentedOn" />{' '}
                        {new Date(app.consentedAt).toLocaleDateString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p>
              <T k="employer.selectPrompt" />
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
