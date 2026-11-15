// Deterministic mock adapter for external career research provider (T3-028-A).
// Used in tests and offline environments to ensure reproducible, non-flaky test runs.
import type {
  CareerResearchProvider,
  SearchProviderOutcome,
  SearchQuery,
  SearchResultItem,
} from '../application/ports/career-research-provider.ts';

export interface MockCareerResearchProviderOptions {
  readonly available?: boolean | undefined;
  readonly defaultItems?: readonly SearchResultItem[] | undefined;
}

export class MockCareerResearchProvider implements CareerResearchProvider {
  readonly name = 'mock-career-research';
  #available: boolean;
  #cannedItems: readonly SearchResultItem[];
  public lastQuery: SearchQuery | null = null;
  public searchCallCount = 0;

  constructor(options: MockCareerResearchProviderOptions = {}) {
    this.#available = options.available ?? true;
    this.#cannedItems = options.defaultItems ?? [
      {
        title: 'Junior Web Developer - Addis Ababa',
        url: 'https://ethiojobs.net/jobs/junior-web-developer',
        domain: 'ethiojobs.net',
        snippet: 'Entry-level front-end developer vacancy in central Addis Ababa.',
      },
      {
        title: 'Remote Data Specialist',
        url: 'https://careers.et/postings/remote-data-specialist',
        domain: 'careers.et',
        snippet: 'Flexible remote role managing database entries and records.',
      },
    ];
  }

  isAvailable(): boolean {
    return this.#available;
  }

  setAvailable(available: boolean): void {
    this.#available = available;
  }

  setCannedItems(items: readonly SearchResultItem[]): void {
    this.#cannedItems = items;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async search(query: SearchQuery): Promise<SearchProviderOutcome> {
    this.searchCallCount++;
    this.lastQuery = query;

    if (!this.#available) {
      return { status: 'unavailable', reason: 'Search provider is disabled.' };
    }

    if (query.text.toLowerCase().includes('rate-limit-test')) {
      return { status: 'rate_limited', retryAfterSeconds: 60 };
    }

    if (query.text.toLowerCase().includes('empty-result-test')) {
      return { status: 'no_results' };
    }

    if (query.text.toLowerCase().includes('error-test')) {
      return { status: 'error', message: 'Upstream gateway failure.' };
    }

    return {
      status: 'success',
      items: this.#cannedItems,
    };
  }
}
