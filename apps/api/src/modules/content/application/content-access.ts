// Permission-filtered retrieval and citation resolution for approved lesson
// content (T3-005-B). Tutoring calls this interface; it never reads content tables.
import type { Principal } from '../../identity/domain/principal.ts';
import {
  expandQuestion,
  readableCourses,
  type CitationResult,
  type GlossaryGroup,
  type Passage,
} from '../domain/retrieval.ts';

export interface LessonReader {
  /**
   * Best-matching sections of current, non-withdrawn versions in these courses,
   * most relevant first. An empty course list returns nothing.
   */
  search(courseIds: readonly string[], question: string, limit: number): Promise<Passage[]>;
  /** Resolves a citation against the source's current version within these courses. */
  resolve(
    courseIds: readonly string[],
    sourceId: string,
    sectionId: string,
  ): Promise<CitationResult>;
}

/** Enough passages for an answer to cite, few enough to keep provider prompts small. */
export const SEARCH_LIMIT = 5;

export class ContentAccess {
  readonly #reader: LessonReader;
  readonly #glossary: readonly GlossaryGroup[];

  constructor(reader: LessonReader, glossary: readonly GlossaryGroup[]) {
    this.#reader = reader;
    this.#glossary = glossary;
  }

  async search(principal: Principal, question: string): Promise<Passage[]> {
    const courses = readableCourses(principal);
    if (courses.length === 0) return [];
    return this.#reader.search(courses, expandQuestion(question, this.#glossary), SEARCH_LIMIT);
  }

  async resolve(
    principal: Principal,
    sourceId: string,
    sectionId: string,
  ): Promise<CitationResult> {
    const courses = readableCourses(principal);
    if (courses.length === 0) return { kind: 'not_found' };
    return this.#reader.resolve(courses, sourceId, sectionId);
  }
}
