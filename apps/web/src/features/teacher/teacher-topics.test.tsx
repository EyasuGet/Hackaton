import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleContext } from '../../shared/i18n/i18n.tsx';
import { TeacherTopics } from './teacher-topics.tsx';
import type { TeacherTopicsData } from './teacher-api.ts';

const TOKEN = 'mock-teacher-token';

const SAMPLE_DATA: TeacherTopicsData = {
  courseId: 'course-1',
  totalQuestions: 12,
  topics: [
    { topic: 'Virtual Assistant Overview', count: 6 },
    { topic: 'Artificial Intelligence and Routine Tasks', count: 4 },
  ],
  suppressedCount: 2,
  kThreshold: 3,
};

const NO_SUPPRESSION_DATA: TeacherTopicsData = {
  courseId: 'course-1',
  totalQuestions: 10,
  topics: [
    { topic: 'Introduction', count: 6 },
    { topic: 'Client Relationships', count: 4 },
  ],
  suppressedCount: 0,
  kThreshold: 3,
};

const EMPTY_DATA: TeacherTopicsData = {
  courseId: 'course-1',
  totalQuestions: 0,
  topics: [],
  suppressedCount: 0,
  kThreshold: 3,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubTeacherApi(status = 200, data: TeacherTopicsData = SAMPLE_DATA) {
  const fetchMock = vi.fn(() => {
    if (status === 200) {
      return Promise.resolve(Response.json(data));
    }
    return Promise.resolve(
      Response.json({ error: status === 403 ? 'forbidden' : 'error' }, { status }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('TeacherTopics Component (T3-030)', () => {
  it('renders aggregate topics table and frequency counts', async () => {
    stubTeacherApi(200, SAMPLE_DATA);

    render(<TeacherTopics token={TOKEN} courseId="course-1" />);

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Topic' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Questions asked' })).toBeTruthy();

    expect(screen.getByText('Virtual Assistant Overview')).toBeTruthy();
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('Artificial Intelligence and Routine Tasks')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('renders low-count suppression notice when suppressedCount > 0', async () => {
    stubTeacherApi(200, SAMPLE_DATA);

    render(<TeacherTopics token={TOKEN} courseId="course-1" />);

    const notice = await screen.findByRole('note');
    expect(notice).toBeTruthy();
    expect(
      screen.getByText(
        'Topics with fewer than 3 questions are suppressed to protect learner privacy.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
  });

  it('does not render low-count notice when suppressedCount is 0', async () => {
    stubTeacherApi(200, NO_SUPPRESSION_DATA);

    render(<TeacherTopics token={TOKEN} courseId="course-1" />);

    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('renders empty notice when no topics exist for the course', async () => {
    stubTeacherApi(200, EMPTY_DATA);

    render(<TeacherTopics token={TOKEN} courseId="course-1" />);

    expect(
      await screen.findByText('No frequently asked topics recorded for this course yet.'),
    ).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders forbidden alert when user is unauthorized or ungranted', async () => {
    stubTeacherApi(403);

    render(<TeacherTopics token={TOKEN} courseId="course-2" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toBeTruthy();
    expect(
      screen.getByText('You do not have permission to view topics for this course.'),
    ).toBeTruthy();
  });

  it('renders in Amharic when wrapped in Amharic LocaleContext', async () => {
    stubTeacherApi(200, SAMPLE_DATA);

    render(
      <LocaleContext value="am">
        <TeacherTopics token={TOKEN} courseId="course-1" />
      </LocaleContext>,
    );

    expect(
      await screen.findByRole('heading', { level: 2, name: 'ተደጋግመው የሚጠየቁ ርዕሶች' }),
    ).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'ርዕስ' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'የተጠየቁ ጥያቄዎች ብዛት' })).toBeTruthy();
    expect(screen.getByText('የተማሪዎችን ግላዊነት ለመጠበቅ ከ3 ያነሱ ጥያቄዎች ያሏቸው ርዕሶች ተደብቀዋል።')).toBeTruthy();
  });
});
