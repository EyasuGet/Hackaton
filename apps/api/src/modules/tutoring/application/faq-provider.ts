// Deterministic approved FAQ provider for tutoring (T3-007-A).
// Matches questions against approved course entries and verifies cited sections exist.
// Unsupported questions or ungranted courses return explicit honest limitation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContentAccess } from '../../content/application/content-access.ts';
import type { Principal } from '../../identity/domain/principal.ts';
import type { FaqAnswerResult, FaqCitation, FaqEntry } from '../domain/faq.ts';

const DEFAULT_FAQ_PATH = fileURLToPath(
  new URL('../../../../../../fixtures/faq/approved-faq.json', import.meta.url),
);

export function loadApprovedFaqs(path?: string): readonly FaqEntry[] {
  const filePath = path ?? DEFAULT_FAQ_PATH;
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as readonly FaqEntry[];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

const LIMITATION_MESSAGES = {
  en: 'I do not have an approved course answer for that question in the materials.',
  am: 'በተሰጠው የትምህርት መረጃ ውስጥ ለቀረበው ጥያቄ የተረጋገጠ መልስ አልተገኘም።',
} as const;

export class FaqProvider {
  readonly #entries: readonly FaqEntry[];
  readonly #content: ContentAccess;

  constructor(content: ContentAccess, entries?: readonly FaqEntry[]) {
    this.#content = content;
    this.#entries = entries ?? loadApprovedFaqs();
  }

  getFaqsForCourse(courseId: string): readonly FaqEntry[] {
    return this.#entries.filter((entry) => entry.courseId === courseId);
  }

  async answer(principal: Principal, courseId: string, question: string): Promise<FaqAnswerResult> {
    const isAmharic = /[\u1200-\u137F]/.test(question);
    const lang = isAmharic ? 'am' : 'en';

    // Must have permission for the course
    if (principal.role !== 'learner' || !principal.courseIds.includes(courseId)) {
      return {
        kind: 'insufficient_evidence',
        answerText: LIMITATION_MESSAGES[lang],
        answerLang: lang,
        citations: [],
      };
    }

    const normQ = normalize(question);
    if (!normQ) {
      return {
        kind: 'insufficient_evidence',
        answerText: LIMITATION_MESSAGES[lang],
        answerLang: lang,
        citations: [],
      };
    }

    // Find best matching approved FAQ in this course
    const candidate = this.#entries.find((entry) => {
      if (entry.courseId !== courseId) return false;
      return entry.patterns.some((pattern) => {
        const normPat = normalize(pattern);
        return normQ.includes(normPat) || normPat.includes(normQ);
      });
    });

    if (!candidate) {
      return {
        kind: 'insufficient_evidence',
        answerText: LIMITATION_MESSAGES[lang],
        answerLang: lang,
        citations: [],
      };
    }

    // Verify citations against ContentAccess
    const verifiedCitations: FaqCitation[] = [];
    for (const citation of candidate.citations) {
      const resolved = await this.#content.resolve(
        principal,
        citation.sourceId,
        citation.sectionId,
      );
      if (resolved.kind === 'section') {
        verifiedCitations.push(citation);
      }
    }

    // If candidate has citations but none resolved, treat as insufficient evidence
    if (candidate.citations.length > 0 && verifiedCitations.length === 0) {
      return {
        kind: 'insufficient_evidence',
        answerText: LIMITATION_MESSAGES[lang],
        answerLang: lang,
        citations: [],
      };
    }

    return {
      kind: 'answered',
      answerText: candidate.answer,
      answerLang: candidate.language,
      citations: verifiedCitations,
    };
  }
}
