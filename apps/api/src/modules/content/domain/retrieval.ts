// Retrieval rules for approved lesson content (T3-005-B): who may read which
// course, how a question is expanded across Amharic and English, and the
// outcomes of resolving a citation.
import type { Principal } from '../../identity/domain/principal.ts';

/** Equivalent English and Amharic terms; a question containing one gains the others. */
export interface GlossaryGroup {
  readonly en: readonly string[];
  readonly am: readonly string[];
}

export interface Passage {
  readonly sourceId: string;
  readonly sectionId: string;
  readonly sourceTitle: string;
  readonly heading: string;
  readonly text: string;
  readonly language: string;
  readonly courseId: string;
  readonly version: string;
}

export interface CitedSection extends Passage {
  readonly anchor: string | null;
  readonly provenance:
    | { readonly kind: 'demo'; readonly note: string }
    | {
        readonly kind: 'organiser';
        readonly repository: string;
        readonly commit: string;
        readonly path: string;
      };
}

/**
 * `not_found` covers both a missing source and one in a course the reader may not
 * see, so existence is never revealed; `unavailable` is only for a permitted
 * source whose cited section was withdrawn or removed by a later version.
 */
export type CitationResult =
  | { readonly kind: 'section'; readonly section: CitedSection }
  | { readonly kind: 'unavailable'; readonly reason: 'withdrawn' | 'removed' }
  | { readonly kind: 'not_found' };

/** Courses whose approved content this principal may read; support staff read none yet. */
export function readableCourses(principal: Principal): readonly string[] {
  return principal.role === 'learner' ? principal.courseIds : [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// English terms match whole words only, so "VA" does not match "value". Amharic
// terms match anywhere, because prefixes and suffixes attach to the word itself.
function mentions(question: string, term: string, language: 'en' | 'am'): boolean {
  if (language === 'am') return question.includes(term);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, 'iu').test(
    question,
  );
}

/** Appends every term from each glossary group the question mentions, in either language. */
export function expandQuestion(question: string, glossary: readonly GlossaryGroup[]): string {
  const additions = glossary
    .filter(
      (group) =>
        group.en.some((term) => mentions(question, term, 'en')) ||
        group.am.some((term) => mentions(question, term, 'am')),
    )
    .flatMap((group) => [...group.en, ...group.am]);
  return additions.length === 0 ? question : `${question} ${additions.join(' ')}`;
}
