import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseContent } from './course-content.tsx';

const TOKEN = 'session-token-for-content-tests';

const RESULT = {
  sourceId: 'demo-time-management-am',
  sectionId: 'planning',
  sourceTitle: 'የጊዜ አጠቃቀም መሠረታዊ ነገሮች',
  heading: 'እቅድ ማውጣት',
  excerpt: 'ቀኑን ከመጀመርዎ በፊት…',
  language: 'am',
};

const SECTION = {
  ...RESULT,
  text: 'ቀኑን ከመጀመርዎ በፊት የሚሠሯቸውን ሥራዎች ይዘርዝሩ።',
  provenance: { kind: 'demo', note: 'Synthetic' },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Fake API: search returns RESULT; opening a section answers with `sectionStatus`. */
function stubApi(sectionStatus = 200, reason = 'removed') {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith('/api/content/search')) {
      return Promise.resolve(Response.json({ passages: [RESULT] }));
    }
    if (sectionStatus === 200) return Promise.resolve(Response.json(SECTION));
    return Promise.resolve(
      Response.json(
        { error: sectionStatus === 404 ? 'not_found' : 'unavailable', reason },
        { status: sectionStatus },
      ),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function searchAndOpen() {
  fireEvent.change(screen.getByLabelText('Search your course material'), {
    target: { value: 'እቅድ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(await screen.findByRole('button', { name: RESULT.heading }));
}

describe('CourseContent', () => {
  it('asks the learner to sign in when there is no session', () => {
    const fetchMock = stubApi();
    render(<CourseContent token={null} />);

    expect(screen.getByText('Sign in to search your course material.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches with the session token and shows language-tagged results', async () => {
    const fetchMock = stubApi();
    render(<CourseContent token={TOKEN} />);

    fireEvent.change(screen.getByLabelText('Search your course material'), {
      target: { value: 'እቅድ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    const result = await screen.findByRole('button', { name: RESULT.heading });
    expect(result.getAttribute('lang')).toBe('am');
    expect(screen.getByRole('status', { name: 'Search status' }).textContent).toBe(
      '1 matching section.',
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/content/search?q=${encodeURIComponent('እቅድ')}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
  });

  it('opens a cited section with its origin, then returns focus to the result', async () => {
    stubApi();
    render(<CourseContent token={TOKEN} />);

    await searchAndOpen();

    const heading = await screen.findByRole('heading', { level: 3, name: RESULT.heading });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(SECTION.text)).toBeTruthy();
    expect(screen.getByText(/Synthetic demo lesson/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: RESULT.heading }));
  });

  it.each([
    [404, 'removed', 'This section is not available to you.'],
    [410, 'removed', 'This section was removed when the lesson was updated.'],
    [410, 'withdrawn', 'This lesson has been withdrawn and can no longer be cited.'],
    [401, 'removed', 'Your demo session has ended.'],
  ])('explains a %i (%s) section response honestly', async (status, reason, message) => {
    stubApi(status, reason);
    render(<CourseContent token={TOKEN} />);

    await searchAndOpen();

    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });
});
