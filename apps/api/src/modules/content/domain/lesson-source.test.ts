import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseLessonSource } from './lesson-source.ts';

const FIXTURES = new URL('../../../../../../fixtures/courses/', import.meta.url);

const valid = {
  sourceId: 'demo-lesson',
  version: 'v1',
  title: 'Demo lesson',
  courseId: 'course-1',
  language: 'en',
  provenance: { kind: 'demo', note: 'Synthetic' },
  sections: [{ id: 'intro', anchor: null, heading: 'Intro', text: 'Hello' }],
};

describe('parseLessonSource', () => {
  it('accepts every shipped fixture', async () => {
    const names = (await readdir(FIXTURES)).filter((name) => name.endsWith('.json'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const result = parseLessonSource(JSON.parse(await readFile(new URL(name, FIXTURES), 'utf8')));
      expect(result.ok ? [] : result.errors, name).toEqual([]);
    }
  });

  it.each([
    ['a misspelt field', { ...valid, titel: 'x' }, 'source.titel is not a recognised field'],
    ['an unsupported language', { ...valid, language: 'fr' }, 'source.language must be'],
    [
      'duplicate section ids',
      { ...valid, sections: [valid.sections[0], valid.sections[0]] },
      'sections[1].id "intro" is duplicated',
    ],
    ['no sections', { ...valid, sections: [] }, 'sections must not be empty'],
    [
      'a withdrawn source with sections',
      { ...valid, withdrawn: true },
      'a withdrawn source must have no sections',
    ],
    [
      'organiser content without a pinned commit',
      {
        ...valid,
        provenance: {
          kind: 'organiser',
          repository: 'https://example.org/repo',
          commit: 'main',
          path: 'page.html',
          container: '#content',
          approval: 'Approved',
        },
      },
      'provenance.commit must be a full 40-character commit hash',
    ],
    [
      'a section without text',
      { ...valid, sections: [{ id: 'intro', anchor: null, heading: 'Intro', text: ' ' }] },
      'sections[0].text must be a non-empty string',
    ],
  ])('rejects %s', (_case, input, message) => {
    const result = parseLessonSource(input);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual(expect.stringContaining(message));
  });
});
