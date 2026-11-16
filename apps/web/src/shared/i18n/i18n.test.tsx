import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocaleContext, T, type MessageKey } from './i18n.tsx';
import { am, ar, en, om, so, ti } from './messages.ts';

afterEach(cleanup);

describe('interface dictionary', () => {
  it('has an Amharic translation for every English key', () => {
    const missing = Object.keys(en).filter((key) => !am[key as MessageKey]?.trim());
    expect(missing).toEqual([]);
  });

  it('has an Afaan Oromoo translation for every English key', () => {
    const missing = Object.keys(en).filter((key) => !om[key as MessageKey]?.trim());
    expect(missing).toEqual([]);
  });

  it('has a Tigrinya translation for every English key', () => {
    const missing = Object.keys(en).filter((key) => !ti[key as MessageKey]?.trim());
    expect(missing).toEqual([]);
  });

  it('has a Somali translation for every English key', () => {
    const missing = Object.keys(en).filter((key) => !so[key as MessageKey]?.trim());
    expect(missing).toEqual([]);
  });

  it('has an Arabic translation for every English key except fallback fixture', () => {
    const missing = Object.keys(en).filter(
      (key) => key !== 'assistant.speakerJob' && !ar[key as MessageKey]?.trim(),
    );
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

  it('isolates an English fallback left-to-right inside the Arabic interface', () => {
    const { container } = render(
      <LocaleContext value="ar">
        <T k="assistant.speakerJob" />
      </LocaleContext>,
    );

    expect(container.innerHTML).toBe('<span lang="en" dir="ltr">Assistant (approved jobs)</span>');
  });
});
