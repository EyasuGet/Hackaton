// Presents one stored instant in the Ethiopian and Gregorian calendars with
// Addis Ababa time. Conversion is delegated to Intl.DateTimeFormat (ECMA-402)
// and its ICU calendar data; this module does not implement calendar arithmetic.
const TIME_ZONE = 'Africa/Addis_Ababa';
const ETHIOPIC = 'ethiopic';
// A display helper receives a stored instant, not a date-only value or a local
// time without an offset. Rejecting the latter prevents environment-dependent parsing.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export type DateLanguage = 'en' | 'am';

export interface AddisDate {
  /** Ethiopian-calendar date, for example "1 Meskerem 2019". */
  readonly ethiopian: string;
  /** Gregorian equivalent in the same language, for example "11 September 2026". */
  readonly gregorian: string;
  /** Twenty-four-hour time in Africa/Addis_Ababa, for example "15:00". */
  readonly addisAbabaTime: string;
}

function dateFormatter(locale: string, calendar: 'ethiopic' | 'gregory') {
  return new Intl.DateTimeFormat(locale, {
    calendar,
    numberingSystem: 'latn',
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function timeFormatter(locale: string) {
  return new Intl.DateTimeFormat(locale, {
    numberingSystem: 'latn',
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

const FORMATTERS = {
  en: {
    ethiopian: dateFormatter('en-GB', ETHIOPIC),
    gregorian: dateFormatter('en-GB', 'gregory'),
    time: timeFormatter('en-GB'),
  },
  am: {
    ethiopian: dateFormatter('am-ET', ETHIOPIC),
    gregorian: dateFormatter('am-ET', 'gregory'),
    time: timeFormatter('am-ET'),
  },
} as const;

// A runtime without Ethiopic data silently falls back to Gregorian. Refuse to
// produce a date rather than label a Gregorian date as Ethiopian.
const ETHIOPIC_AVAILABLE =
  FORMATTERS.en.ethiopian.resolvedOptions().calendar === ETHIOPIC &&
  FORMATTERS.am.ethiopian.resolvedOptions().calendar === ETHIOPIC;

// English CLDR appends the Ethiopic era abbreviation "AM" (Amete Mihret), which
// reads as morning. The caller labels the calendar, so keep only the date parts.
function formatCalendarDate(formatter: Intl.DateTimeFormat, date: Date): string {
  return formatter
    .formatToParts(date)
    .filter(({ type }) => type === 'day' || type === 'month' || type === 'year')
    .map(({ value }) => value)
    .join(' ');
}

/**
 * Formats a stored ISO 8601 instant for display. Returns null when the instant
 * is invalid or the runtime cannot render the Ethiopian calendar, so callers can
 * omit the date line instead of guessing.
 */
export function formatAddisDate(instant: string, language: DateLanguage): AddisDate | null {
  if (!ETHIOPIC_AVAILABLE || !ISO_INSTANT.test(instant)) return null;

  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;

  const formatters = FORMATTERS[language];
  return {
    ethiopian: formatCalendarDate(formatters.ethiopian, date),
    gregorian: formatCalendarDate(formatters.gregorian, date),
    addisAbabaTime: formatters.time.format(date),
  };
}
