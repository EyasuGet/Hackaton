// Loads the draft bilingual glossary (pending competent-speaker review) used to expand questions across
// Amharic and English (fixtures/retrieval/bilingual-glossary.json).
import { readFile } from 'node:fs/promises';
import type { GlossaryGroup } from '../domain/retrieval.ts';

export const GLOSSARY_FILE = new URL(
  '../../../../../../fixtures/retrieval/bilingual-glossary.json',
  import.meta.url,
);

function isTermList(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((term) => typeof term === 'string' && term.trim() !== '')
  );
}

/** Fails loudly on a malformed file: a silently empty glossary would hide cross-language misses. */
export async function loadGlossary(file: URL = GLOSSARY_FILE): Promise<GlossaryGroup[]> {
  const data: unknown = JSON.parse(await readFile(file, 'utf8'));
  const groups = typeof data === 'object' && data !== null && 'groups' in data ? data.groups : null;
  if (!Array.isArray(groups)) throw new Error(`${file.pathname}: "groups" must be an array`);
  return groups.map((group: unknown, index) => {
    const en = typeof group === 'object' && group !== null && 'en' in group ? group.en : null;
    const am = typeof group === 'object' && group !== null && 'am' in group ? group.am : null;
    if (!isTermList(en) || !isTermList(am) || en.length === 0 || am.length === 0) {
      throw new Error(
        `${file.pathname}: groups[${index}] needs non-empty "en" and "am" term lists`,
      );
    }
    return { en, am };
  });
}
