import { describe, expect, it } from 'vitest';
import { lookup, type MessageKey } from './i18n.tsx';
import { am, en } from './messages.ts';

describe('interface dictionary', () => {
  it('has an Amharic translation for every English key', () => {
    const missing = Object.keys(en).filter((key) => !am[key as MessageKey]?.trim());
    expect(missing).toEqual([]);
  });

  it('falls back to English, labelled as English, for an untranslated key', () => {
    const partial = { en, am: { 'assistant.send': 'ላክ' } };

    expect(lookup('am', 'assistant.send', partial)).toEqual({ text: 'ላክ', lang: 'am' });
    expect(lookup('am', 'assistant.heading', partial)).toEqual({
      text: 'Conversation',
      lang: 'en',
    });
  });
});
