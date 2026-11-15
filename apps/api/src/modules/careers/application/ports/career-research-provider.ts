// Port interface for external career search providers (T3-028-A).
// Used to query external web search indices without leaking private learner details.

export interface SearchQuery {
  readonly text: string;
  readonly limit?: number | undefined;
  readonly language?: 'en' | 'am' | undefined;
}

export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly domain?: string | undefined;
  readonly snippet: string;
}

export type SearchProviderOutcome =
  | { readonly status: 'success'; readonly items: readonly SearchResultItem[] }
  | { readonly status: 'no_results' }
  | { readonly status: 'unavailable'; readonly reason?: string | undefined }
  | { readonly status: 'rate_limited'; readonly retryAfterSeconds?: number | undefined }
  | { readonly status: 'error'; readonly message: string };

export interface CareerResearchProvider {
  readonly name: string;
  /** Reports whether the external search provider is configured and available. */
  isAvailable(): boolean;
  /** Searches the external index using the minimized query. */
  search(query: SearchQuery, options?: { signal?: AbortSignal }): Promise<SearchProviderOutcome>;
}
