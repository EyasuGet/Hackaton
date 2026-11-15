import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PostgresEmployerRepository } from './postgres-employer-repository.ts';

describe('PostgresEmployerRepository', () => {
  it('maps created vacancy and queries correctly', async () => {
    const mockRow = {
      id: 'vac-1',
      employer_id: 'emp-1',
      title: 'Senior Frontend Engineer',
      description: 'Lead web platform work.',
      category: 'Engineering',
      location: 'Addis Ababa',
      status: 'active' as const,
      created_at: new Date('2026-01-01T00:00:00Z'),
      expires_at: new Date('2026-01-31T00:00:00Z'),
    };

    const mockPool = {
      query: (sql: string, params: unknown[]) => {
        if (sql.includes('INSERT INTO employer_vacancies')) {
          expect(params[0]).toBe('emp-1');
          expect(params[1]).toBe('Senior Frontend Engineer');
          return Promise.resolve({ rows: [mockRow] });
        }
        if (
          sql.includes(
            'SELECT id, employer_id, title, description, category, location, status, created_at, expires_at FROM employer_vacancies WHERE id = $1 AND employer_id = $2',
          )
        ) {
          return Promise.resolve({ rows: [mockRow] });
        }
        if (sql.includes('FROM employer_vacancies')) {
          return Promise.resolve({ rows: [mockRow] });
        }
        if (sql.includes('FROM consented_applications')) {
          return Promise.resolve({
            rows: [
              {
                id: 'app-1',
                vacancy_id: 'vac-1',
                learner_id: 'lrn-1',
                learner_full_name: 'Abebe Kebede',
                contact_channel: 'abebe@example.com',
                resume_url: 'https://example.com/resume.pdf',
                status: 'submitted',
                consented_at: new Date('2026-01-02T00:00:00Z'),
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    } as unknown as pg.Pool;

    const repo = new PostgresEmployerRepository(mockPool);

    const created = await repo.createVacancy('emp-1', {
      title: 'Senior Frontend Engineer',
      description: 'Lead web platform work.',
      category: 'Engineering',
      location: 'Addis Ababa',
    });

    expect(created.id).toBe('vac-1');
    expect(created.employerId).toBe('emp-1');
    expect(created.title).toBe('Senior Frontend Engineer');

    const list = await repo.listVacancies('emp-1');
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('vac-1');

    const apps = await repo.listApplications('emp-1', 'vac-1');
    expect(apps).not.toBeNull();
    expect(apps?.length).toBe(1);
    expect(apps?.[0]?.learnerFullName).toBe('Abebe Kebede');
    expect(apps?.[0]?.resumeUrl).toBe('https://example.com/resume.pdf');
  });

  it('returns null when querying applications for non-existent vacancy', async () => {
    const mockPool = {
      query: () => Promise.resolve({ rows: [] }),
    } as unknown as pg.Pool;

    const repo = new PostgresEmployerRepository(mockPool);
    const apps = await repo.listApplications('emp-1', 'missing-id');
    expect(apps).toBeNull();
  });
});
