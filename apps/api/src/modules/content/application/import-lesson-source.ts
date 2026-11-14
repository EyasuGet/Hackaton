// Imports one approved lesson source version. Validation happens before any
// storage call, and the repository applies a version atomically, so a bad file
// can never replace or damage the currently approved content.
import { createHash } from 'node:crypto';
import { parseLessonSource, type LessonSource } from '../domain/lesson-source.ts';

export type ImportOutcome =
  | { readonly status: 'imported'; readonly version: string; readonly sections: number }
  | { readonly status: 'withdrawn'; readonly version: string }
  | { readonly status: 'unchanged'; readonly version: string };

export interface LessonRepository {
  /**
   * Atomically makes this version the source's current one, unless the current
   * version already has the same checksum. Throws VersionConflictError when the
   * label was already used by another stored version; nothing changes then.
   */
  importVersion(source: LessonSource, checksum: string): Promise<ImportOutcome>;
}

export class InvalidLessonSourceError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid lesson source: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

export class VersionConflictError extends Error {
  constructor(sourceId: string, version: string) {
    // Also covers re-importing an older version after a newer one: restoring
    // earlier content needs a new label, so the history stays unambiguous.
    super(
      `Version "${version}" of ${sourceId} is already used by another stored version; use a new version label`,
    );
  }
}

/**
 * A stable fingerprint of the content, with a fixed key order. The version label
 * is deliberately excluded: relabelling identical content is not a new version.
 */
export function checksumOf(source: LessonSource): string {
  const canonical = JSON.stringify([
    source.sourceId,
    source.title,
    source.courseId,
    source.language,
    source.provenance,
    source.withdrawn,
    source.sections.map((s) => [s.id, s.anchor, s.heading, s.text]),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

export class ImportLessonSource {
  readonly #repository: LessonRepository;

  constructor(repository: LessonRepository) {
    this.#repository = repository;
  }

  /** @throws InvalidLessonSourceError before touching storage when the input is malformed. */
  async execute(input: unknown): Promise<ImportOutcome> {
    const parsed = parseLessonSource(input);
    if (!parsed.ok) throw new InvalidLessonSourceError(parsed.errors);
    return this.#repository.importVersion(parsed.source, checksumOf(parsed.source));
  }
}
