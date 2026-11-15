// The interface language for the learner shell: a React context holding the
// chosen locale, its writing direction, a lookup that falls back to English for an
// untranslated key, and <T> for visible text, which tags such a fallback lang="en".
import { createContext, useContext } from 'react';
import { am, ar, en, om, so, ti, type Locale, type MessageKey } from './messages.ts';

export type { Locale, MessageKey };

const DICTIONARIES: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en,
  am,
  om,
  ti,
  so,
  ar,
};

export function localeDirection(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

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

/**
 * Visible interface text; an English fallback inside another locale is tagged so it is
 * read correctly, and isolated left-to-right inside a right-to-left page.
 */
export function T({ k }: { k: MessageKey }) {
  const locale = useContext(LocaleContext);
  const { text, lang } = lookup(locale, k);
  if (lang === locale) return text;
  return localeDirection(locale) === 'rtl' ? (
    <span lang={lang} dir="ltr">
      {text}
    </span>
  ) : (
    <span lang={lang}>{text}</span>
  );
}
