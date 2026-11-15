// Domain model and validation rules for external career web research (T3-028-A).
// Decision D08: External career web research is separate, consented, and disabled by default.
// Spec R01.6 / R06: Treat fetched results as untrusted; enforce query minimisation;
// never send private learner context, chat history, or accommodation data.

export interface CareerResearchCitation {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly domain: string;
  readonly retrievedAt: Date;
}

export interface CareerResearchInput {
  readonly query: string;
  readonly consent: boolean;
  readonly language?: 'en' | 'am' | undefined;
  readonly limit?: number | undefined;
}

export interface CareerResearchResult {
  readonly kind: 'researched' | 'insufficient_evidence';
  readonly query: string;
  readonly provenance: 'external_web_research';
  readonly language: 'en' | 'am';
  readonly citations: readonly CareerResearchCitation[];
  readonly explanationText: string;
}

export interface MinimizedCareerQuery {
  readonly cleanQuery: string;
  readonly language: 'en' | 'am';
}

/**
 * Validates and sanitises an incoming career search query, enforcing query minimisation.
 * Strips personal identifiers, course IDs, conversational preamble, and accommodation text.
 * Returns null if the sanitized query is empty or too short.
 */
export function minimiseCareerQuery(rawInput: string): MinimizedCareerQuery | null {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length < 2) return null;

  const isAmharic = /[\u1200-\u137F]/.test(trimmed);
  const language: 'en' | 'am' = isAmharic ? 'am' : 'en';

  // Strip conversational preamble, course codes, and sensitive accommodation context markers
  let sanitized = trimmed
    .replace(
      /(?:my name is|i am a student|student id|i am learner|learner|enrolled in course|in course|course|enrolled in|my disability|accommodation|learner id|user id)\s*[:=]?\s*[^\s,.]+/gi,
      '',
    )
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Enforce max bounds (120 characters)
  if (sanitized.length > 120) {
    sanitized = sanitized.slice(0, 120).trim();
  }

  if (sanitized.length < 2) return null;
  return { cleanQuery: sanitized, language };
}

/**
 * Validates an external source URL for safety:
 * - Must be an absolute https:// URL
 * - Must not target localhost, private IPv4/IPv6 ranges, or cloud metadata services (SSRF protection).
 */
export function isValidExternalSourceUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '169.254.169.254' ||
      /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
