// The interface language for the learner shell: a React context holding the
// chosen locale, a lookup that falls back to English for an untranslated key,
// and <T> for visible text, which tags such a fallback lang="en".
import { createContext, useContext } from 'react';
import { am, en, type Locale, type MessageKey } from './messages.ts';

export type { Locale, MessageKey };

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = { en, am };

/** The text for `key` in `locale`, and the language that text is actually in. */
export function lookup(locale: Locale, key: MessageKey): { text: string; lang: Locale } {
  const text = DICTIONARIES[locale][key];
  return text === undefined ? { text: en[key], lang: 'en' } : { text, lang: locale };
}

export const LocaleContext = createContext<Locale>('en');

/** Translates attribute text (labels, titles), where no lang tag can be attached. */
export function useT(): (key: MessageKey) => string {
  const locale = useContext(LocaleContext);
  return (key) => lookup(locale, key).text;
}

/** Visible interface text; an English fallback inside Amharic is tagged so it is read correctly. */
export function T({ k }: { k: MessageKey }) {
  const locale = useContext(LocaleContext);
  const { text, lang } = lookup(locale, k);
  return lang === locale ? text : <span lang={lang}>{text}</span>;
}
