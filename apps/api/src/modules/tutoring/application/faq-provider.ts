// Deterministic approved FAQ provider for tutoring (T3-007-A, matching and quotes T3-054).
// Answers in order: an approved FAQ entry whose key words appear in the question; else a
// word-for-word quote of the most relevant lesson passage, flagged `quoted`; else an
// explicit honest limitation. Nothing is generated, and every citation is verified.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContentAccess } from '../../content/application/content-access.ts';
import type { Passage } from '../../content/domain/retrieval.ts';
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
  return (
    text
      .toLowerCase()
      // Apostrophes join a word ("what's", "VA's"); other punctuation separates words.
      .replace(/['’]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// Question words that carry no topic, in English and Amharic.
const STOPWORDS = new Set(
  [
    'a an and are about as at be by can could did do does explain for from has have how i in is it me my of on or our please should tell that the their there they this to us we what when where which who why will with would you your',
    'ስለ ምን ምንድን ምንድነው ነው ናቸው ነበር እንዴት ለምን የት መቼ ማን ይህ ያ እና ውስጥ',
  ]
    .join(' ')
    .split(' '),
);

// Course abbreviations learners type; each also matches its spelled-out words.
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  va: 'virtual assistant',
  vas: 'virtual assistants',
};

/** Light plural folding so "tasks" matches "task"; short words are left alone. */
function stem(word: string): string {
  return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

/** Topic words of `text`, each with the alternative spellings that satisfy it. */
function keyWords(text: string): string[][] {
  return normalize(text)
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .map((word) => [word, ...(ABBREVIATIONS[word] ? [ABBREVIATIONS[word]] : [])]);
}

/** True when every word of `alternative` begins a word of `tokens` (prefixes absorb suffixes). */
function present(alternative: string, tokens: readonly string[]): boolean {
  return alternative.split(' ').every((part) => {
    const root = stem(part);
    return tokens.some((token) => (root.length > 3 ? token.startsWith(root) : token === part));
  });
}

/** Share of `words` found in `tokens`, and how many were found. */
function coverage(words: readonly string[][], tokens: readonly string[]) {
  const found = words.filter((alternatives) => alternatives.some((a) => present(a, tokens))).length;
  return { found, share: words.length === 0 ? 0 : found / words.length };
}

/**
 * An approved entry matches when 3/4 of its pattern's key words (at least two) are asked
 * and 3/4 of the question's key words are in the pattern, so an extra topic such as
 * "replace" in "Will AI replace virtual assistants?" is not answered by a definition.
 */
const FAQ_MATCH = 0.75;
/** A passage is quoted only when 2/3 of the question's key words occur in it (at least two). */
const QUOTE_MATCH = 2 / 3;
/** Long enough to answer, short enough for a phone screen and an SMS-sized read-aloud. */
const QUOTE_MAX_CHARS = 420;

/**
 * A contiguous slice of `text`, starting at the sentence or line with most key words and
 * extended by whole sentences or lines, so the quote is verbatim, line breaks included.
 */
function excerpt(text: string, words: readonly string[][]): string {
  // Segment boundaries: whitespace after sentence-ending punctuation, or a line break.
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const separator of text.matchAll(/(?<=[.!?።])\s+|\n+/g)) {
    spans.push({ start: cursor, end: separator.index });
    cursor = separator.index + separator[0].length;
  }
  spans.push({ start: cursor, end: text.length });
  const segments = spans.filter(({ start, end }) => text.slice(start, end).trim());
  let best = 0;
  let bestFound = -1;
  segments.forEach(({ start, end }, index) => {
    const { found } = coverage(words, normalize(text.slice(start, end)).split(' '));
    if (found > bestFound) [best, bestFound] = [index, found];
  });
  const first = segments[best];
  if (!first) return '';
  let end = first.end;
  for (const next of segments.slice(best + 1)) {
    if (next.end - first.start > QUOTE_MAX_CHARS) break;
    end = next.end;
  }
  return text.slice(first.start, end).trim();
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
    const limitation: FaqAnswerResult = {
      kind: 'insufficient_evidence',
      answerText: LIMITATION_MESSAGES[lang],
      answerLang: lang,
      citations: [],
    };

    // Must have permission for the course
    if (principal.role !== 'learner' || !principal.courseIds.includes(courseId)) {
      return limitation;
    }

    const normQ = normalize(question);
    if (!normQ) return limitation;

    const entry = this.#bestEntry(courseId, normQ);
    if (entry) {
      // Verify citations against ContentAccess
      const verifiedCitations: FaqCitation[] = [];
      for (const citation of entry.citations) {
        const resolved = await this.#content.resolve(
          principal,
          citation.sourceId,
          citation.sectionId,
        );
        if (resolved.kind === 'section') verifiedCitations.push(citation);
      }
      // An entry whose citations no longer resolve is not evidence; try a quote instead.
      if (entry.citations.length === 0 || verifiedCitations.length > 0) {
        return {
          kind: 'answered',
          answerText: entry.answer,
          answerLang: entry.language,
          citations: verifiedCitations,
        };
      }
    }

    return (await this.#quote(principal, courseId, question)) ?? limitation;
  }

  /** The approved entry in this course whose pattern the question covers best, if any. */
  #bestEntry(courseId: string, normQ: string): FaqEntry | undefined {
    const tokens = normQ.split(' ');
    const questionWords = keyWords(normQ);
    // A question of only question words ("what is") asks about nothing in particular.
    if (questionWords.length === 0) return undefined;
    let best: { entry: FaqEntry; share: number } | undefined;
    for (const entry of this.#entries) {
      if (entry.courseId !== courseId) continue;
      for (const pattern of entry.patterns) {
        const normPat = normalize(pattern);
        const { found, share } = coverage(keyWords(pattern), tokens);
        const asked = coverage(questionWords, normPat.split(' ')).share;
        const both = Math.min(share, asked);
        // The whole pattern asked word for word still counts in full ("va" never matches "value").
        const score = ` ${normQ} `.includes(` ${normPat} `)
          ? 1
          : found >= 2 && both >= FAQ_MATCH
            ? both
            : 0;
        if (score > (best?.share ?? 0)) best = { entry, share: score };
      }
    }
    return best?.entry;
  }

  /** A verbatim, cited excerpt of the best-covered lesson passage in this course. */
  async #quote(
    principal: Principal,
    courseId: string,
    question: string,
  ): Promise<FaqAnswerResult | undefined> {
    const words = keyWords(question);
    if (words.length === 0) return undefined;
    const passages = (await this.#content.search(principal, question)).filter(
      (p) => p.courseId === courseId,
    );
    let best: { passage: Passage; share: number } | undefined;
    for (const passage of passages) {
      const tokens = normalize(`${passage.heading} ${passage.text}`).split(' ');
      const { found, share } = coverage(words, tokens);
      const enough = share >= QUOTE_MATCH && (found >= 2 || words.length === 1);
      if (enough && share > (best?.share ?? 0)) best = { passage, share };
    }
    if (!best) return undefined;
    const { passage } = best;
    return {
      kind: 'answered',
      answerText: excerpt(passage.text, words),
      answerLang: passage.language === 'am' ? 'am' : 'en',
      citations: [
        {
          sourceId: passage.sourceId,
          sectionId: passage.sectionId,
          sourceTitle: passage.sourceTitle,
          heading: passage.heading,
        },
      ],
      quoted: true,
    };
  }
}
