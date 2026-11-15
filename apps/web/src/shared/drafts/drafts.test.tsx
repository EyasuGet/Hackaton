import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { clearAllDrafts, DraftNotice, useDraft } from './drafts.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Field() {
  const [value, setValue] = useDraft('field');
  return (
    <>
      <label htmlFor="field">Field</label>
      <textarea id="field" value={value} onChange={(e) => setValue(e.target.value)} />
      <DraftNotice value={value} onClear={() => setValue('')} />
    </>
  );
}

describe('useDraft', () => {
  it('keeps typed text across a reload and says where it is saved', () => {
    const { unmount } = render(<Field />);
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'Unsent text' } });
    unmount();

    render(<Field />);

    expect(screen.getByLabelText('Field')).toHaveProperty('value', 'Unsent text');
    expect(screen.getByText(/saved on this device only/)).toBeTruthy();
  });

  it('removes the saved text when the learner clears the draft', () => {
    render(<Field />);
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'Unsent text' } });

    fireEvent.click(screen.getByRole('button', { name: 'Clear draft' }));

    expect(screen.getByLabelText('Field')).toHaveProperty('value', '');
    expect(localStorage.length).toBe(0);
    expect(screen.queryByText(/saved on this device only/)).toBeNull();
  });

  it('clears every draft but leaves other saved settings', () => {
    localStorage.setItem('track3.draft.help', 'Help text');
    localStorage.setItem('track3.preferences', '{"locale":"am"}');

    clearAllDrafts();

    expect(localStorage.getItem('track3.draft.help')).toBeNull();
    expect(localStorage.getItem('track3.preferences')).toBe('{"locale":"am"}');
  });
});
