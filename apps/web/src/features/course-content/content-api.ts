// Browser side of the course-content contract (T3-005-B): search the signed-in
// learner's courses and resolve a cited section. Responses are validated, not trusted.

export interface SearchResult {
  readonly sourceId: string;
  readonly sectionId: string;
  readonly sourceTitle: string;
  readonly heading: string;
  readonly excerpt: string;
  readonly language: string;
}

export interface Section {
  readonly sourceTitle: string;
  readonly heading: string;
  readonly text: string;
  readonly language: string;
  readonly provenance: string;
}

export type SearchOutcome =
  | { readonly kind: 'results'; readonly results: SearchResult[] }
  | { readonly kind: 'signed-out' | 'failed' };

export type SectionOutcome =
  | { readonly kind: 'section'; readonly section: Section }
  | { readonly kind: 'not-found' | 'withdrawn' | 'removed' | 'signed-out' | 'failed' };

// Any non-null object can be read field by field; each field is type-checked before use.
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function strings<K extends string>(value: unknown, keys: readonly K[]): Record<K, string> | null {
  const item = record(value);
  if (!item || !keys.every((key) => typeof item[key] === 'string')) return null;
  return Object.fromEntries(keys.map((key) => [key, item[key]])) as Record<K, string>;
}

const RESULT_KEYS = [
  'sourceId',
  'sectionId',
  'sourceTitle',
  'heading',
  'excerpt',
  'language',
] as const;

export async function searchContent(token: string, question: string): Promise<SearchOutcome> {
  try {
    const response = await fetch(`/api/content/search?q=${encodeURIComponent(question)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401) return { kind: 'signed-out' };
    const body = record(await response.json());
    if (!response.ok || !Array.isArray(body?.passages)) return { kind: 'failed' };
    const results = body.passages.map((passage: unknown) => strings(passage, RESULT_KEYS));
    if (results.some((result) => result === null)) return { kind: 'failed' };
    return { kind: 'results', results: results.filter((result) => result !== null) };
  } catch {
    return { kind: 'failed' };
  }
}

/** A readable one-line origin for the cited section. */
function describeProvenance(value: unknown): string | null {
  const provenance = record(value);
  if (provenance?.kind === 'demo') return 'Synthetic demo lesson — not approved teaching content.';
  const organiser = strings(provenance, ['repository', 'commit', 'path']);
  if (provenance?.kind === 'organiser' && organiser) {
    return `Approved lesson from ${organiser.repository} (${organiser.path}, commit ${organiser.commit.slice(0, 7)}).`;
  }
  return null;
}

export async function openSection(
  token: string,
  sourceId: string,
  sectionId: string,
): Promise<SectionOutcome> {
  try {
    const response = await fetch(
      `/api/content/sources/${encodeURIComponent(sourceId)}/sections/${encodeURIComponent(sectionId)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (response.status === 401) return { kind: 'signed-out' };
    if (response.status === 404) return { kind: 'not-found' };
    const body = record(await response.json());
    if (response.status === 410)
      return { kind: body?.reason === 'withdrawn' ? 'withdrawn' : 'removed' };
    const fields = strings(body, ['sourceTitle', 'heading', 'text', 'language']);
    const provenance = describeProvenance(body?.provenance);
    if (!response.ok || !fields || !provenance) return { kind: 'failed' };
    return { kind: 'section', section: { ...fields, provenance } };
  } catch {
    return { kind: 'failed' };
  }
}
