import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmployerDashboard } from './employer-dashboard.tsx';
import type { ConsentedApplication, EmployerVacancy } from './employer-api.ts';

describe('EmployerDashboard', () => {
  const dummyVacancies: readonly EmployerVacancy[] = [
    {
      id: 'vac-1',
      employerId: 'emp-1',
      title: 'Junior QA Engineer',
      description: 'Test accessibility and interfaces.',
      category: 'Quality Assurance',
      location: 'Addis Ababa',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-02-01T00:00:00.000Z',
    },
  ];

  const dummyApplications: readonly ConsentedApplication[] = [
    {
      id: 'app-1',
      vacancyId: 'vac-1',
      learnerId: 'lrn-1',
      learnerFullName: 'Selamawit Tadesse',
      contactChannel: 'selam@example.com',
      resumeUrl: 'https://example.com/resume.pdf',
      status: 'submitted',
      consentedAt: '2026-01-05T00:00:00.000Z',
    },
  ];

  // The role /api/me reports for the signed-in principal.
  let meRole = 'employer';

  beforeEach(() => {
    meRole = 'employer';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options?: RequestInit) => {
        const u = typeof url === 'string' ? url : (url as URL).pathname;
        if (u === '/api/me') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ role: meRole }) });
        }
        if (
          u === '/api/employer/vacancies' &&
          (!options || !options.method || options.method === 'GET')
        ) {
          return Promise.resolve({
            ok: true,
            statusText: 'OK',
            json: () => Promise.resolve({ vacancies: dummyVacancies }),
          });
        }
        if (u === '/api/employer/vacancies' && options?.method === 'POST') {
          const bodyStr = typeof options.body === 'string' ? options.body : '';
          const body = JSON.parse(bodyStr) as {
            title: string;
            description: string;
            category?: string;
            location?: string;
          };
          return Promise.resolve({
            ok: true,
            statusText: 'Created',
            json: () =>
              Promise.resolve({
                id: 'vac-2',
                employerId: 'emp-1',
                title: body.title,
                description: body.description,
                category: body.category || 'General',
                location: body.location || 'Remote',
                status: 'active',
                createdAt: new Date().toISOString(),
                expiresAt: new Date().toISOString(),
              }),
          });
        }
        if (u.includes('/applications')) {
          return Promise.resolve({
            ok: true,
            statusText: 'OK',
            json: () =>
              Promise.resolve({
                vacancyId: 'vac-1',
                applications: dummyApplications,
                privacyNotice: 'Applications presented under explicit candidate consent.',
              }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${u}`));
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders privacy banner stating strict privacy boundary', async () => {
    render(<EmployerDashboard sessionToken="emp-test-token" />);

    expect(await screen.findByRole('note', { name: /privacy boundary notice/i })).toBeTruthy();
    expect(screen.getByText(/strict privacy boundary:/i)).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('Junior QA Engineer')).toBeTruthy();
    });
  });

  it('allows posting a new vacancy', async () => {
    render(<EmployerDashboard sessionToken="emp-test-token" />);

    await waitFor(() => {
      expect(screen.getByText('Junior QA Engineer')).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/role title \*/i), {
      target: { value: 'Frontend React Specialist' },
    });
    fireEvent.change(screen.getByLabelText(/description \*/i), {
      target: { value: 'Build accessible UI components.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /publish vacancy/i }));

    await waitFor(() => {
      expect(screen.getByText('Frontend React Specialist')).toBeTruthy();
    });
  });

  it('displays consented applicants and privacy disclaimer on selecting vacancy', async () => {
    render(<EmployerDashboard sessionToken="emp-test-token" />);

    await waitFor(() => {
      expect(screen.getByText('Junior QA Engineer')).toBeTruthy();
    });

    const viewButton = screen.getByRole('button', { name: /view consented applicants/i });
    fireEvent.click(viewButton);

    await waitFor(() => {
      expect(screen.getByText('Selamawit Tadesse')).toBeTruthy();
      expect(screen.getByText(/selam@example.com/i)).toBeTruthy();
      expect(screen.getByText(/explicit candidate consent/i)).toBeTruthy();
      expect(
        screen.getByRole('link', { name: /view candidate resume/i }).getAttribute('href'),
      ).toBe('https://example.com/resume.pdf');
    });
  });

  it('renders nothing and requests no vacancies for a non-employer role', async () => {
    meRole = 'learner';
    const { container } = render(<EmployerDashboard sessionToken="learner-token" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/me', expect.anything()));
    await Promise.resolve();
    expect(container.innerHTML).toBe('');
    expect(fetch).not.toHaveBeenCalledWith('/api/employer/vacancies', expect.anything());
  });
});
