// An approved lesson source as imported: one version of a lesson's ordered
// sections, with its course scope, language and provenance. Parsing is strict
// because import files are written by hand and errors must surface before any
// stored content changes.

export type Language = 'en' | 'am';

/** Where a source came from: synthetic demo content, or approved organiser material pinned to a commit. */
export type Provenance =
  | { readonly kind: 'demo'; readonly note: string }
  | {
      readonly kind: 'organiser';
      readonly repository: string;
      readonly commit: string;
      readonly path: string;
      readonly container: string;
      readonly approval: string;
    };

export interface LessonSection {
  readonly id: string;
  /** Fragment id in the original page, or null when the section has no anchor of its own. */
  readonly anchor: string | null;
  readonly heading: string;
  readonly text: string;
}

export interface LessonSource {
  readonly sourceId: string;
  /** Author-assigned label; must change whenever the content changes. */
  readonly version: string;
  readonly title: string;
  readonly courseId: string;
  readonly language: Language;
  readonly provenance: Provenance;
  /** A withdrawn source has no sections and stops being an answer source. */
  readonly withdrawn: boolean;
  readonly sections: readonly LessonSection[];
}

export type ParseResult =
  | { readonly ok: true; readonly source: LessonSource }
  | { readonly ok: false; readonly errors: readonly string[] };

const ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const MAX_SECTIONS = 200;
const MAX_HEADING = 200;
const MAX_TEXT = 20_000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Collects every problem instead of stopping at the first, so an author can fix
 * a file in one pass. Unknown keys are errors: a misspelt key would otherwise be
 * silently ignored.
 */
class Checker {
  readonly errors: string[] = [];

  keys(value: Json, path: string, allowed: readonly string[]): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) this.errors.push(`${path}.${key} is not a recognised field`);
    }
  }

  text(value: Json, key: string, path: string, max: number): string {
    const field = value[key];
    if (typeof field !== 'string' || !field.trim()) {
      this.errors.push(`${path}.${key} must be a non-empty string`);
      return '';
    }
    if (field.length > max) this.errors.push(`${path}.${key} is longer than ${max} characters`);
    return field;
  }

  matching(value: Json, key: string, path: string, pattern: RegExp, description: string): string {
    const field = value[key];
    if (typeof field !== 'string' || !pattern.test(field)) {
      this.errors.push(`${path}.${key} must be ${description}`);
      return '';
    }
    return field;
  }
}

const ID_DESCRIPTION = 'lowercase letters, digits and hyphens';

function parseProvenance(check: Checker, value: unknown): Provenance | null {
  if (!isObject(value)) {
    check.errors.push('provenance must be an object');
    return null;
  }
  if (value.kind === 'demo') {
    check.keys(value, 'provenance', ['kind', 'note']);
    return { kind: 'demo', note: check.text(value, 'note', 'provenance', 500) };
  }
  if (value.kind === 'organiser') {
    check.keys(value, 'provenance', [
      'kind',
      'repository',
      'commit',
      'path',
      'container',
      'approval',
    ]);
    return {
      kind: 'organiser',
      repository: check.matching(
        value,
        'repository',
        'provenance',
        /^https:\/\/\S+$/,
        'an https URL',
      ),
      // A pinned commit, not a branch: the cited text must be reproducible.
      commit: check.matching(
        value,
        'commit',
        'provenance',
        COMMIT,
        'a full 40-character commit hash',
      ),
      path: check.text(value, 'path', 'provenance', 300),
      container: check.text(value, 'container', 'provenance', 300),
      approval: check.text(value, 'approval', 'provenance', 500),
    };
  }
  check.errors.push('provenance.kind must be "demo" or "organiser"');
  return null;
}

function parseSections(check: Checker, value: unknown, withdrawn: boolean): LessonSection[] {
  if (!Array.isArray(value)) {
    check.errors.push('sections must be an array');
    return [];
  }
  if (withdrawn && value.length > 0) check.errors.push('a withdrawn source must have no sections');
  if (!withdrawn && value.length === 0) check.errors.push('sections must not be empty');
  if (value.length > MAX_SECTIONS) check.errors.push(`sections must not exceed ${MAX_SECTIONS}`);

  const seen = new Set<string>();
  return value.map((item: unknown, index) => {
    const path = `sections[${index}]`;
    if (!isObject(item)) {
      check.errors.push(`${path} must be an object`);
      return { id: '', anchor: null, heading: '', text: '' };
    }
    check.keys(item, path, ['id', 'anchor', 'heading', 'text']);
    const id = check.matching(item, 'id', path, ID, ID_DESCRIPTION);
    // Section ids are citation targets, so they must be unique within a version.
    if (id && seen.has(id)) check.errors.push(`${path}.id "${id}" is duplicated`);
    seen.add(id);
    const anchor =
      item.anchor === null
        ? null
        : check.matching(item, 'anchor', path, ID, `null or ${ID_DESCRIPTION}`);
    return {
      id,
      anchor,
      heading: check.text(item, 'heading', path, MAX_HEADING),
      text: check.text(item, 'text', path, MAX_TEXT),
    };
  });
}

/** Validates untrusted import input. Nothing is stored unless this returns ok. */
export function parseLessonSource(input: unknown): ParseResult {
  if (!isObject(input)) return { ok: false, errors: ['the source must be a JSON object'] };
  const check = new Checker();
  check.keys(input, 'source', [
    'sourceId',
    'version',
    'title',
    'courseId',
    'language',
    'provenance',
    'withdrawn',
    'sections',
  ]);

  const withdrawn = input.withdrawn ?? false;
  if (typeof withdrawn !== 'boolean') check.errors.push('source.withdrawn must be true or false');
  const language = input.language;
  if (language !== 'en' && language !== 'am')
    check.errors.push('source.language must be "en" or "am"');

  const source = {
    sourceId: check.matching(input, 'sourceId', 'source', ID, ID_DESCRIPTION),
    version: check.text(input, 'version', 'source', 64),
    title: check.text(input, 'title', 'source', MAX_HEADING),
    courseId: check.matching(input, 'courseId', 'source', ID, ID_DESCRIPTION),
    language: language === 'am' ? 'am' : 'en',
    provenance: parseProvenance(check, input.provenance),
    withdrawn: withdrawn === true,
    sections: parseSections(check, input.sections, withdrawn === true),
  } as const;

  if (check.errors.length > 0 || !source.provenance) {
    return { ok: false, errors: check.errors };
  }
  return { ok: true, source: { ...source, provenance: source.provenance } };
}

/**
 * Decides what an import does given the source's current version. Identical
 * content is a no-op whatever its label, so reimporting never duplicates rows.
 */
export function planImport(
  current: { readonly checksum: string } | null,
  incomingChecksum: string,
): 'unchanged' | 'new-version' {
  return current?.checksum === incomingChecksum ? 'unchanged' : 'new-version';
}
