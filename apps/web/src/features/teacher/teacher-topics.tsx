// Authorised teacher view of aggregate frequently asked topics per course (T3-030).
// Enforces low-count k-anonymity suppression (k >= 3) to protect learner privacy.
// Strictly excludes personal learner IDs, names, timestamps, and conversation transcripts.
import { useEffect, useId, useState } from 'react';
import { T } from '../../shared/i18n/i18n.tsx';
import {
  fetchTeacherTopics,
  type FetchTopicsResult,
  type TeacherTopicsData,
} from './teacher-api.ts';

export interface TeacherTopicsProps {
  readonly token: string | null;
  readonly courseId?: string;
  readonly initialData?: TeacherTopicsData | null;
  readonly onDataLoaded?: (data: TeacherTopicsData) => void;
}

export function TeacherTopics({
  token,
  courseId = 'course-1',
  initialData = null,
  onDataLoaded,
}: TeacherTopicsProps) {
  const [data, setData] = useState<TeacherTopicsData | null>(initialData);
  const [phase, setPhase] = useState<
    'idle' | 'loading' | 'ok' | 'forbidden' | 'unauthenticated' | 'error'
  >(initialData ? 'ok' : 'idle');

  const headingId = useId();

  useEffect(() => {
    if (!token) {
      setPhase('unauthenticated');
      setData(null);
      return;
    }

    if (initialData) {
      setData(initialData);
      setPhase('ok');
      return;
    }

    let cancelled = false;
    setPhase('loading');

    void fetchTeacherTopics(token, courseId).then((result: FetchTopicsResult) => {
      if (cancelled) return;
      if (result.kind === 'ok') {
        setData(result.data);
        setPhase('ok');
        onDataLoaded?.(result.data);
      } else {
        setData(null);
        setPhase(result.kind);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token, courseId, initialData, onDataLoaded]);

  return (
    <section className="teacher-topics" aria-labelledby={headingId}>
      <h2 id={headingId}>
        <T k="teacher.topicsHeading" />
      </h2>
      <p className="teacher-topics-desc">
        <T k="teacher.topicsDescription" />
      </p>

      {phase === 'loading' && (
        <p role="status" aria-live="polite">
          <T k="teacher.loading" />
        </p>
      )}

      {phase === 'forbidden' && (
        <p role="alert" className="error-message">
          <T k="teacher.forbidden" />
        </p>
      )}

      {phase === 'error' && (
        <p role="alert" className="error-message">
          <T k="teacher.error" />
        </p>
      )}

      {phase === 'ok' && data && (
        <div className="teacher-topics-content">
          <div className="teacher-topics-meta">
            <span className="course-badge">
              <T k="teacher.courseLabel" />: <strong>{data.courseId}</strong>
            </span>
            <span className="total-questions-badge">
              <T k="teacher.totalQuestions" />: <strong>{data.totalQuestions}</strong>
            </span>
          </div>

          {data.topics.length === 0 ? (
            <p className="teacher-topics-empty">
              <T k="teacher.empty" />
            </p>
          ) : (
            <table className="teacher-topics-table">
              <caption className="sr-only">
                <T k="teacher.topicsHeading" />
              </caption>
              <thead>
                <tr>
                  <th scope="col">
                    <T k="teacher.topicColumn" />
                  </th>
                  <th scope="col" className="count-col">
                    <T k="teacher.countColumn" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topics.map((item) => (
                  <tr key={item.topic}>
                    <td>{item.topic}</td>
                    <td className="count-col">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.suppressedCount > 0 && (
            <div role="note" className="suppression-notice" aria-live="polite">
              <p className="suppression-text">
                <T k="teacher.suppressionNotice" />
              </p>
              <span className="suppressed-badge">({data.suppressedCount})</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
