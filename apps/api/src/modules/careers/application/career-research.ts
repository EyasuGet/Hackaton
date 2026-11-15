// Application use case for external career web research (T3-028-A).
// Decision D08: Separate, consented, disabled by default.
// Enforces learner ownership, query minimisation, genuine provenance labels,
// source URL safety checks, and action isolation (strictly read-only).
import type { Principal } from '../../identity/domain/principal.ts';
import {
  type CareerResearchCitation,
  type CareerResearchInput,
  type CareerResearchResult,
  isValidExternalSourceUrl,
  minimiseCareerQuery,
} from '../domain/career-research.ts';
import type { CareerResearchProvider, SearchQuery } from './ports/career-research-provider.ts';

export type CareerResearchErrorCode =
  | 'consent_required'
  | 'invalid_query'
  | 'unauthorized'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'provider_error';

export class CareerResearchError extends Error {
  readonly code: CareerResearchErrorCode;
  readonly retryAfterSeconds?: number | undefined;

  constructor(code: CareerResearchErrorCode, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'CareerResearchError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class CareerResearchService {
  readonly #provider: CareerResearchProvider;

  constructor(provider: CareerResearchProvider) {
    this.#provider = provider;
  }

  get providerName(): string {
    return this.#provider.name;
  }

  isAvailable(): boolean {
    return this.#provider.isAvailable();
  }

  /**
   * Performs external career web research on behalf of an authenticated learner.
   * Rejects queries without explicit consent (`consent === true`).
   * Strips all private learner, accommodation, and conversation context.
   */
  async research(
    principal: Principal,
    input: CareerResearchInput,
    options?: { signal?: AbortSignal },
  ): Promise<CareerResearchResult> {
    if (principal.role !== 'learner') {
      throw new CareerResearchError(
        'unauthorized',
        'Career web research is restricted to authenticated learners.',
      );
    }

    if (input.consent !== true) {
      throw new CareerResearchError(
        'consent_required',
        'Explicit learner consent is required to perform external web research.',
      );
    }

    const minimised = minimiseCareerQuery(input.query);
    if (!minimised) {
      throw new CareerResearchError(
        'invalid_query',
        'Search query must contain valid job or skill keywords.',
      );
    }

    if (!this.#provider.isAvailable()) {
      throw new CareerResearchError(
        'provider_unavailable',
        'External career research provider is currently unavailable.',
      );
    }

    const searchQuery: SearchQuery = {
      text: minimised.cleanQuery,
      limit: input.limit ?? 5,
      language: input.language ?? minimised.language,
    };

    const outcome = await this.#provider.search(searchQuery, options);

    if (outcome.status === 'unavailable') {
      throw new CareerResearchError(
        'provider_unavailable',
        outcome.reason ?? 'Provider unavailable',
      );
    }

    if (outcome.status === 'rate_limited') {
      throw new CareerResearchError(
        'rate_limited',
        'External search rate limit exceeded; please try again later.',
        outcome.retryAfterSeconds,
      );
    }

    if (outcome.status === 'error') {
      throw new CareerResearchError('provider_error', outcome.message);
    }

    const lang = input.language ?? minimised.language;

    if (outcome.status === 'no_results' || outcome.items.length === 0) {
      return {
        kind: 'insufficient_evidence',
        query: minimised.cleanQuery,
        provenance: 'external_web_research',
        language: lang,
        citations: [],
        explanationText:
          lang === 'am'
            ? 'ለቀረበው የበይነመረብ ፍለጋ ተዛማጅ የሥራ መረጃ አልተገኘም።'
            : 'No external career research results found for this query.',
      };
    }

    // Filter valid HTTPS URLs and sanitize snippets
    const citations: CareerResearchCitation[] = [];
    const now = new Date();

    for (const item of outcome.items) {
      if (!isValidExternalSourceUrl(item.url)) {
        continue;
      }

      let domain = item.domain;
      if (!domain) {
        try {
          domain = new URL(item.url).hostname;
        } catch {
          domain = 'external';
        }
      }

      citations.push({
        title: item.title.trim(),
        url: item.url,
        domain,
        snippet: item.snippet
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<[^>]*>/g, '')
          .trim(),
        retrievedAt: now,
      });
    }

    if (citations.length === 0) {
      return {
        kind: 'insufficient_evidence',
        query: minimised.cleanQuery,
        provenance: 'external_web_research',
        language: lang,
        citations: [],
        explanationText:
          lang === 'am'
            ? 'ለቀረበው የበይነመረብ ፍለጋ ተዛማጅ የሥራ መረጃ አልተገኘም።'
            : 'No external career research results found for this query.',
      };
    }

    return {
      kind: 'researched',
      query: minimised.cleanQuery,
      provenance: 'external_web_research',
      language: lang,
      citations,
      explanationText:
        lang === 'am'
          ? `በውጭ በይነመረብ ፍለጋ ${citations.length} የሥራ መረጃዎች ተገኝተዋል (የማረጋገጫ ምልክት፡ external_web_research)።`
          : `Found ${citations.length} external career research result(s) (provenance: external_web_research).`,
    };
  }
}
