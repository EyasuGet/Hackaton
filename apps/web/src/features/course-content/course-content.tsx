// Course material for the signed-in learner: search permitted lessons and read a
// cited section in place (a reload would end the in-memory demo session).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { openSection, searchContent, type SearchResult, type Section } from './content-api.ts';

type View =
  | { readonly kind: 'idle' | 'searching' }
  | { readonly kind: 'results'; readonly results: SearchResult[] }
  | { readonly kind: 'section'; readonly section: Section; readonly results: SearchResult[] };

const PROBLEMS = {
  'signed-out': 'Your demo session has ended. Ask the demo operator for a new sign-in link.',
  failed: 'Course material could not be loaded. Check your connection and try again.',
  'not-found': 'This section is not available to you.',
  withdrawn: 'This lesson has been withdrawn and can no longer be cited.',
  removed: 'This section was removed when the lesson was updated.',
} as const;

type Problem = keyof typeof PROBLEMS;

export function CourseContent({ token }: { token: string | null }) {
  const [question, setQuestion] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [problem, setProblem] = useState<Problem | null>(null);
  const [opener, setOpener] = useState<string | null>(null);
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  const resultButtons = useRef(new Map<string, HTMLButtonElement>());
  const ids = { heading: useId(), search: useId() };

  // Opening a section moves focus to it; going back returns focus to the result that opened it.
  useEffect(() => {
    if (view.kind === 'section') sectionHeading.current?.focus();
    else if (view.kind === 'results' && opener) resultButtons.current.get(opener)?.focus();
  }, [view, opener]);

  if (!token) {
    return (
      <section aria-labelledby={ids.heading}>
        <h2 id={ids.heading}>Your course material</h2>
        <p>Sign in to search your course material.</p>
      </section>
    );
  }
  const session = token;

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || view.kind === 'searching') return;
    setProblem(null);
    setOpener(null);
    setView({ kind: 'searching' });
    const outcome = await searchContent(session, question.trim());
    if (outcome.kind === 'results') setView({ kind: 'results', results: outcome.results });
    else {
      setProblem(outcome.kind);
      setView({ kind: 'idle' });
    }
  }

  async function onOpen(result: SearchResult, results: SearchResult[]) {
    setProblem(null);
    const key = `${result.sourceId}/${result.sectionId}`;
    setOpener(key);
    const outcome = await openSection(session, result.sourceId, result.sectionId);
    if (outcome.kind === 'section') setView({ kind: 'section', section: outcome.section, results });
    else setProblem(outcome.kind);
  }

  return (
    <section aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>Your course material</h2>
      <form onSubmit={(event) => void onSearch(event)} role="search">
        <label htmlFor={ids.search}>Search your course material</label>
        <input
          id={ids.search}
          type="search"
          value={question}
          dir="auto"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" aria-disabled={view.kind === 'searching'}>
          Search
        </button>
      </form>
      {problem && <p role="alert">{PROBLEMS[problem]}</p>}
      <p role="status" aria-label="Search status">
        {view.kind === 'searching' && 'Searching…'}
        {view.kind === 'results' &&
          (view.results.length === 0
            ? 'No matching course material found.'
            : `${view.results.length} matching section${view.results.length === 1 ? '' : 's'}.`)}
      </p>

      {view.kind === 'results' && view.results.length > 0 && (
        <ol className="search-results">
          {view.results.map((result) => {
            const key = `${result.sourceId}/${result.sectionId}`;
            return (
              <li key={key}>
                <button
                  type="button"
                  className="link-button"
                  lang={result.language}
                  ref={(element) => {
                    if (element) resultButtons.current.set(key, element);
                    else resultButtons.current.delete(key);
                  }}
                  onClick={() => void onOpen(result, view.results)}
                >
                  {result.heading}
                </button>
                <p className="hint">{result.sourceTitle}</p>
                <p lang={result.language} dir="auto">
                  {result.excerpt}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {view.kind === 'section' && (
        <article className="cited-section" lang={view.section.language}>
          <h3 ref={sectionHeading} tabIndex={-1} dir="auto">
            {view.section.heading}
          </h3>
          <p className="hint" lang="en">
            From “<span lang={view.section.language}>{view.section.sourceTitle}</span>”.{' '}
            {view.section.provenance}
          </p>
          <p className="message-text" dir="auto">
            {view.section.text}
          </p>
          <button
            type="button"
            lang="en"
            onClick={() => setView({ kind: 'results', results: view.results })}
          >
            Back to results
          </button>
        </article>
      )}
    </section>
  );
}
