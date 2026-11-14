import { describe, expect, it } from 'vitest';
import { expandQuestion, readableCourses, type GlossaryGroup } from './retrieval.ts';

const glossary: GlossaryGroup[] = [
  { en: ['virtual assistant', 'VA'], am: ['ምናባዊ ረዳት'] },
  { en: ['plan'], am: ['እቅድ'] },
];

describe('expandQuestion', () => {
  it('adds the other language’s terms when an English term is mentioned', () => {
    expect(expandQuestion('What does a VA do?', glossary)).toBe(
      'What does a VA do? virtual assistant VA ምናባዊ ረዳት',
    );
  });

  it('matches Amharic terms inside words that carry prefixes or suffixes', () => {
    expect(expandQuestion('የምናባዊ ረዳትን ሥራ', glossary)).toContain('virtual assistant');
  });

  it('matches English terms as whole words only', () => {
    expect(expandQuestion('What do clients value? I planned ahead.', glossary)).toBe(
      'What do clients value? I planned ahead.',
    );
  });
});

describe('readableCourses', () => {
  it('lets learners read their granted courses and support staff none', () => {
    const base = { id: 'p', label: 'x', demo: true, courseIds: ['course-1'] };
    expect(readableCourses({ ...base, role: 'learner' })).toEqual(['course-1']);
    expect(readableCourses({ ...base, role: 'support' })).toEqual([]);
  });
});
