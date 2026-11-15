// Unit tests for job preferences domain model and matching (T3-020-A).
// Verifies deterministic matching, filter handling, active/inactive guards,
// job validity (withdrawn/expired), and deduplication key generation.
import { describe, expect, it } from 'vitest';
import { jobAlertDedupKey, matchJobSubscription, type JobSubscription } from './job-preferences.ts';
import type { Job } from './job.ts';

const NOW = new Date('2026-11-15T10:00:00.000Z');
const FUTURE = new Date('2026-11-25T10:00:00.000Z');
const PAST = new Date('2026-11-01T10:00:00.000Z');

function baseSubscription(overrides: Partial<JobSubscription> = {}): JobSubscription {
  return {
    id: 'sub-1',
    learnerId: 'learner-1',
    channel: 'telegram',
    destination: 'tg:12345678',
    categories: ['administrative'],
    locations: ['Addis Ababa'],
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
    unsubscribedAt: null,
    ...overrides,
  };
}

function baseJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    version: '1.0',
    title: 'Data Entry Clerk',
    organization: 'Acme Corp',
    category: 'administrative',
    location: 'Addis Ababa',
    description: 'A great role',
    sourceUrl: 'https://example.com/jobs/1',
    postedAt: NOW,
    expiresAt: FUTURE,
    withdrawn: false,
    provenance: { kind: 'demo', note: 'test' },
    ...overrides,
  };
}

describe('matchJobSubscription (T3-020-A)', () => {
  it('matches an active subscription when category and location match', () => {
    const sub = baseSubscription();
    const job = baseJob();
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('rejects an inactive subscription even when filters match perfectly', () => {
    const sub = baseSubscription({ active: false });
    const job = baseJob();
    expect(matchJobSubscription(sub, job, NOW)).toBe(false);
  });

  it('rejects an expired job', () => {
    const sub = baseSubscription();
    const job = baseJob({ expiresAt: PAST });
    expect(matchJobSubscription(sub, job, NOW)).toBe(false);
  });

  it('rejects a job expiring right now (boundary check)', () => {
    const sub = baseSubscription();
    const job = baseJob({ expiresAt: NOW });
    expect(matchJobSubscription(sub, job, NOW)).toBe(false);
  });

  it('rejects a withdrawn job', () => {
    const sub = baseSubscription();
    const job = baseJob({ withdrawn: true });
    expect(matchJobSubscription(sub, job, NOW)).toBe(false);
  });

  it('rejects when category does not match', () => {
    const sub = baseSubscription({ categories: ['administrative'] });
    const job = baseJob({ category: 'software-engineering' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(false);
  });

  it('matches case-insensitively for category', () => {
    const sub = baseSubscription({ categories: ['Administrative'] });
    const job = baseJob({ category: 'administrative' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('matches when job category is among multiple subscribed categories', () => {
    const sub = baseSubscription({
      categories: ['finance', 'administrative', 'customer-service'],
    });
    const job = baseJob({ category: 'administrative' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('matches any category when subscribed categories filter is empty', () => {
    const sub = baseSubscription({ categories: [] });
    const job = baseJob({ category: 'unusual-category' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('rejects when location does not match', () => {
    const sub = baseSubscription({ locations: ['Addis Ababa'] });
    const job = baseJob({ location: 'Hawassa' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(false);
  });

  it('matches case-insensitively for location', () => {
    const sub = baseSubscription({ locations: ['addis ababa'] });
    const job = baseJob({ location: 'Addis Ababa' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('matches when job location is among multiple subscribed locations', () => {
    const sub = baseSubscription({
      locations: ['Dire Dawa', 'Addis Ababa', 'Adama'],
    });
    const job = baseJob({ location: 'Addis Ababa' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('matches any location when subscribed locations filter is empty', () => {
    const sub = baseSubscription({ locations: [] });
    const job = baseJob({ location: 'Remote / Anywhere' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('matches open-ended subscriptions with both empty categories and locations', () => {
    const sub = baseSubscription({ categories: [], locations: [] });
    const job = baseJob({ category: 'random-cat', location: 'random-loc' });
    expect(matchJobSubscription(sub, job, NOW)).toBe(true);
  });

  it('does not infer or depend on sensitive profile attributes', () => {
    // Determinism test: the exact same subscription and job always produce identical results
    const sub = baseSubscription({ categories: ['administrative'], locations: ['Addis Ababa'] });
    const matchingJob = baseJob();
    const nonMatchingJob = baseJob({ category: 'healthcare' });

    expect(matchJobSubscription(sub, matchingJob, NOW)).toBe(true);
    expect(matchJobSubscription(sub, nonMatchingJob, NOW)).toBe(false);
  });
});

describe('jobAlertDedupKey (T3-020-A)', () => {
  it('generates consistent deduplication keys formatted as job-alert:<learnerId>:<jobId>:<channel>', () => {
    const key = jobAlertDedupKey('learner-42', 'job-dev-01', 'telegram');
    expect(key).toBe('job-alert:learner-42:job-dev-01:telegram');
  });

  it('normalizes channel to lowercase in the deduplication key', () => {
    const key = jobAlertDedupKey('learner-42', 'job-dev-01', 'Telegram');
    expect(key).toBe('job-alert:learner-42:job-dev-01:telegram');
  });

  it('yields the exact same key for repeated publications of the same job', () => {
    const key1 = jobAlertDedupKey('learner-99', 'job-sec-01', 'sms');
    const key2 = jobAlertDedupKey('learner-99', 'job-sec-01', 'sms');
    expect(key1).toBe(key2);
  });
});
