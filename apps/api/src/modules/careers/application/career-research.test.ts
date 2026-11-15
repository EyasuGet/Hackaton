// Application unit tests for CareerResearchService (T3-028-A).
// Verifies explicit consent gate, query minimisation egress, action isolation,
// provider failure mapping, rate limits, and distinct provenance attribution.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '../../identity/domain/principal.ts';
import { CareerResearchError, CareerResearchService } from './career-research.ts';
import { MockCareerResearchProvider } from '../infrastructure/mock-career-research-provider.ts';

const learnerPrincipal: Principal = {
  id: '00000000-0000-0000-0000-000000000001',
  role: 'learner',
  label: 'Learner A',
  demo: true,
  courseIds: ['course-1'],
};

const supportPrincipal: Principal = {
  id: '00000000-0000-0000-0000-000000000002',
  role: 'support',
  label: 'Support Staff',
  demo: true,
  courseIds: [],
};

describe('CareerResearchService Application Use Case (T3-028-A)', () => {
  let mockProvider: MockCareerResearchProvider;
  let service: CareerResearchService;

  beforeEach(() => {
    mockProvider = new MockCareerResearchProvider();
    service = new CareerResearchService(mockProvider);
  });

  describe('Explicit Consent Gate (Decision D08)', () => {
    it('throws consent_required error when consent is false', async () => {
      await expect(
        service.research(learnerPrincipal, {
          query: 'frontend developer',
          consent: false,
        }),
      ).rejects.toThrow(CareerResearchError);

      try {
        await service.research(learnerPrincipal, {
          query: 'frontend developer',
          consent: false,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(CareerResearchError);
        expect((err as CareerResearchError).code).toBe('consent_required');
      }

      // External provider must NEVER be contacted without explicit consent
      expect(mockProvider.searchCallCount).toBe(0);
    });

    it('rejects non-learner principals with unauthorized error', async () => {
      await expect(
        service.research(supportPrincipal, {
          query: 'frontend developer',
          consent: true,
        }),
      ).rejects.toMatchObject({
        code: 'unauthorized',
      });
      expect(mockProvider.searchCallCount).toBe(0);
    });
  });

  describe('Query Minimisation and Egress Privacy', () => {
    it('sends minimized query without private learner details to external provider', async () => {
      const result = await service.research(learnerPrincipal, {
        query:
          'My name is Abebe and I am enrolled in course CS101. What frontend developer jobs exist in Hawassa?',
        consent: true,
      });

      expect(mockProvider.searchCallCount).toBe(1);
      expect(mockProvider.lastQuery).not.toBeNull();
      expect(mockProvider.lastQuery?.text).not.toContain('Abebe');
      expect(mockProvider.lastQuery?.text).not.toContain('CS101');
      expect(mockProvider.lastQuery?.text).toContain('frontend developer jobs exist in Hawassa');

      expect(result.kind).toBe('researched');
      expect(result.provenance).toBe('external_web_research');
      expect(result.citations.length).toBeGreaterThan(0);
    });

    it('rejects blank or invalid queries before reaching provider', async () => {
      await expect(
        service.research(learnerPrincipal, {
          query: '   ',
          consent: true,
        }),
      ).rejects.toMatchObject({
        code: 'invalid_query',
      });
      expect(mockProvider.searchCallCount).toBe(0);
    });
  });

  describe('Untrusted Result Filtering & Provenance Labelling', () => {
    it('labels results explicitly with external_web_research provenance and strips unsafe URLs', async () => {
      mockProvider.setCannedItems([
        {
          title: 'Legitimate Role',
          url: 'https://careers.et/job/1',
          domain: 'careers.et',
          snippet: 'Safe description snippet',
        },
        {
          title: 'Malicious Insecure Link',
          url: 'http://insecure-site.org/malware',
          domain: 'insecure-site.org',
          snippet: 'Insecure snippet',
        },
        {
          title: 'SSRF Attack Link',
          url: 'https://169.254.169.254/latest/meta-data',
          domain: 'metadata',
          snippet: 'Cloud metadata snippet',
        },
        {
          title: 'HTML Injection Link',
          url: 'https://careers.et/job/2',
          domain: 'careers.et',
          snippet: '<script>alert(1)</script>Safe text after script',
        },
      ]);

      const result = await service.research(learnerPrincipal, {
        query: 'software engineer',
        consent: true,
      });

      expect(result.provenance).toBe('external_web_research');
      // Only the 2 HTTPS safe URLs should be retained
      expect(result.citations).toHaveLength(2);
      expect(result.citations[0]?.url).toBe('https://careers.et/job/1');
      expect(result.citations[1]?.url).toBe('https://careers.et/job/2');
      // Script tags must be stripped from snippet
      expect(result.citations[1]?.snippet).toBe('Safe text after script');
    });

    it('returns honest bilingual insufficient_evidence result when provider finds no hits', async () => {
      const enResult = await service.research(learnerPrincipal, {
        query: 'empty-result-test english',
        consent: true,
        language: 'en',
      });
      expect(enResult.kind).toBe('insufficient_evidence');
      expect(enResult.citations).toHaveLength(0);
      expect(enResult.explanationText).toContain('No external career research results found');

      const amResult = await service.research(learnerPrincipal, {
        query: 'empty-result-test አማርኛ',
        consent: true,
        language: 'am',
      });
      expect(amResult.kind).toBe('insufficient_evidence');
      expect(amResult.citations).toHaveLength(0);
      expect(amResult.explanationText).toContain('ለቀረበው የበይነመረብ ፍለጋ ተዛማጅ የሥራ መረጃ አልተገኘም');
    });
  });

  describe('Provider Failures and Resilience', () => {
    it('throws provider_unavailable when search provider is offline', async () => {
      mockProvider.setAvailable(false);

      await expect(
        service.research(learnerPrincipal, {
          query: 'developer',
          consent: true,
        }),
      ).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
    });

    it('maps upstream rate limits to rate_limited error with retryAfterSeconds', async () => {
      await expect(
        service.research(learnerPrincipal, {
          query: 'rate-limit-test developer',
          consent: true,
        }),
      ).rejects.toMatchObject({
        code: 'rate_limited',
        retryAfterSeconds: 60,
      });
    });

    it('maps upstream provider errors properly', async () => {
      await expect(
        service.research(learnerPrincipal, {
          query: 'error-test developer',
          consent: true,
        }),
      ).rejects.toMatchObject({
        code: 'provider_error',
      });
    });
  });
});
