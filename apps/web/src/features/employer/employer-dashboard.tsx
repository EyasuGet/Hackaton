// Employer Recruitment Dashboard Component (T3-031).
// Provides recruitment pipeline management strictly isolated from learner personal tutoring and accommodations.
import { useEffect, useState, type FormEvent } from 'react';
import { EmployerApi, type ConsentedApplication, type EmployerVacancy } from './employer-api.ts';

interface EmployerDashboardProps {
  readonly sessionToken: string;
}

export function EmployerDashboard({ sessionToken }: EmployerDashboardProps) {
  const [api] = useState(() => new EmployerApi(sessionToken));
  const [vacancies, setVacancies] = useState<readonly EmployerVacancy[]>([]);
  const [selectedVacancy, setSelectedVacancy] = useState<EmployerVacancy | null>(null);
  const [applications, setApplications] = useState<readonly ConsentedApplication[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vacancies');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load applications');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreateVacancy(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post vacancy');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="employer-dashboard" data-testid="employer-dashboard">
      <header className="employer-header">
        <h2>Employer Recruitment Portal</h2>
        <div className="privacy-banner" role="note" aria-label="Privacy Boundary Notice">
          <p>
            <strong>Strict Privacy Boundary:</strong> Employers only access job vacancies and
            candidates who explicitly consented by submitting applications. Learner tutoring
            conversations, disability accommodations, and non-consented profiles are strictly
            inaccessible.
          </p>
        </div>
      </header>

      {error && (
        <div className="alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="employer-grid">
        <section className="employer-section" aria-labelledby="post-vacancy-heading">
          <h3 id="post-vacancy-heading">Post New Vacancy</h3>
          <form
            onSubmit={(e) => {
              void handleCreateVacancy(e);
            }}
            className="vacancy-form"
          >
            <div className="form-group">
              <label htmlFor="vacancy-title">Job Title *</label>
              <input
                id="vacancy-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Junior Frontend Developer"
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="vacancy-category">Category</label>
              <input
                id="vacancy-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Technology"
              />
            </div>

            <div className="form-group">
              <label htmlFor="vacancy-location">Location</label>
              <input
                id="vacancy-location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Addis Ababa / Remote"
              />
            </div>

            <div className="form-group">
              <label htmlFor="vacancy-description">Description *</label>
              <textarea
                id="vacancy-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe responsibilities and requirements"
                rows={4}
                required
              />
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary">
              {isSubmitting ? 'Posting...' : 'Publish Vacancy'}
            </button>
          </form>
        </section>

        <section className="employer-section" aria-labelledby="vacancies-heading">
          <h3 id="vacancies-heading">Your Vacancies</h3>
          {isLoading && !selectedVacancy && <p>Loading vacancies...</p>}
          {vacancies.length === 0 && !isLoading ? (
            <p>No vacancies published yet.</p>
          ) : (
            <ul className="vacancy-list" aria-label="Vacancies">
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
                    View Consented Applicants
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="employer-section" aria-labelledby="applicants-heading">
          <h3 id="applicants-heading">Consented Applicants</h3>
          {selectedVacancy ? (
            <div>
              <p className="selected-meta">
                Showing candidates for: <strong>{selectedVacancy.title}</strong>
              </p>
              {privacyNotice && <div className="notice-banner">{privacyNotice}</div>}
              {applications.length === 0 ? (
                <p>No candidates have applied yet.</p>
              ) : (
                <ul className="application-list" aria-label="Candidate applications">
                  {applications.map((app) => (
                    <li key={app.id} className="application-card">
                      <h4>{app.learnerFullName}</h4>
                      <p>
                        <strong>Contact:</strong> {app.contactChannel}
                      </p>
                      {app.resumeUrl && (
                        <p>
                          <a href={app.resumeUrl} target="_blank" rel="noopener noreferrer">
                            View Candidate Resume
                          </a>
                        </p>
                      )}
                      <p className="meta-text">
                        Applied & Consented: {new Date(app.consentedAt).toLocaleDateString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p>Select a vacancy above to view candidates who consented to share their profile.</p>
          )}
        </section>
      </div>
    </div>
  );
}
