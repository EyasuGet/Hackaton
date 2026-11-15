// Unsent text kept on this device (T3-047), so a reload or an expired session never
// loses what a learner typed (WCAG 2.2.1 / 2.2.5). Setting a draft to '' removes it.
import { useEffect, useState } from 'react';
import { T } from '../i18n/i18n.tsx';

const DRAFT_PREFIX = 'track3.draft.';

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private browsing or a full quota: the draft still lives in memory.
  }
}

/** Like useState for a text field, but saved on this device under `name`. */
export function useDraft(name: string) {
  const key = `${DRAFT_PREFIX}${name}`;
  const [value, setValue] = useState(() => readDraft(key));
  useEffect(() => writeDraft(key, value), [key, value]);
  return [value, setValue] as const;
}

/** Removes every saved draft, for an explicit sign-out on a shared device. */
export function clearAllDrafts(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DRAFT_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing was saved if storage is unavailable.
  }
}

export function DraftNotice({ value, onClear }: { value: string; onClear: () => void }) {
  if (!value.trim()) return null;
  return (
    <p className="draft-notice">
      <T k="draft.savedOnDevice" />{' '}
      <button type="button" onClick={onClear}>
        <T k="draft.clear" />
      </button>
    </p>
  );
}
