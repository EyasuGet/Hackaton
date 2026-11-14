import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleContext, T, type MessageKey } from './i18n.tsx';
import { am, en } from './messages.ts';

afterEach(cleanup);

describe('interface dictionary', () => {
  it('has an Amharic translation for every English key', () => {
    const missing = Object.keys(en).filter((key) => !am[key as MessageKey]?.trim());
    expect(missing).toEqual([]);
  });

  it('shows an untranslated key in English, tagged as English', () => {
    const original = { ...am };
    delete am['assistant.send'];
    try {
      const { container } = render(
        <LocaleContext value="am">
          <T k="assistant.send" />
        </LocaleContext>,
      );

      expect(container.innerHTML).toBe('<span lang="en">Send</span>');
    } finally {
      Object.assign(am, original);
    }
  });
});
