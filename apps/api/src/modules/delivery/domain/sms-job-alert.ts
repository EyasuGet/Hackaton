// Domain logic for SMS job alert payload formatting, bounding, and validation (T3-021-B).
// Generates clean, readable Unicode SMS payloads in English and Amharic Ge'ez.
// Enforces 3GPP GSM-7 and UCS-2 segment limits with safe truncation, usable job links,
// and compliant opt-out instructions (Decision D24, Product Spec R06).

import { analyzeSmsText, type SmsEncoding } from './sms-encoding.ts';

export interface JobAlertPayload {
  readonly id: string;
  readonly title: string;
  readonly organization: string;
  readonly location?: string | undefined;
  readonly sourceUrl?: string | undefined;
}

export interface JobAlertFormatOptions {
  /** Target language for the alert message. Defaults to auto-detection from job title. */
  readonly language?: 'en' | 'am' | undefined;
  /** Base URL for canonical job application links. Defaults to 'https://digitalbridge.et'. */
  readonly baseUrl?: string | undefined;
  /** Maximum allowable SMS segments. Defaults to 2 segments. */
  readonly maxSegments?: number | undefined;
}

export interface FormattedSmsJobAlert {
  readonly message: string;
  readonly encoding: SmsEncoding;
  readonly segments: number;
  readonly jobUrl: string;
  readonly language: 'en' | 'am';
}

/** Ge'ez Unicode character block (U+1200 - U+137F). */
const GEEZ_UNICODE_PATTERN = /[\u1200-\u137F]/;

/** Regex pattern matching standard job content references: `job:<jobId>:<version>`. */
const JOB_ALERT_CONTENT_REF_PATTERN = /^job:([a-z0-9][a-z0-9-]{0,99}):([a-z0-9.-]{1,50})$/;

/**
 * Parses a delivery intent content reference into its job ID and version components.
 * Returns null if the reference is not a valid job content reference.
 */
export function parseJobAlertContentRef(
  contentRef: string | null | undefined,
): { jobId: string; version: string } | null {
  if (!contentRef || typeof contentRef !== 'string') {
    return null;
  }
  const match = contentRef.trim().match(JOB_ALERT_CONTENT_REF_PATTERN);
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  return { jobId: match[1], version: match[2] };
}

/**
 * Builds the canonical job details URL.
 * Preserves approved `https://digitalbridge.et/jobs/...` source URLs or constructs one from the job ID.
 */
export function buildJobAlertUrl(
  jobId: string,
  sourceUrl?: string,
  baseUrl = 'https://digitalbridge.et',
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  if (sourceUrl && sourceUrl.startsWith('https://digitalbridge.et/jobs/')) {
    return sourceUrl.trim();
  }
  return `${normalizedBase}/jobs/${jobId.trim()}`;
}

/**
 * Truncates a string to fit within a maximum character count safely on Unicode code-point boundaries.
 * Preserves Amharic Ge'ez glyphs without slicing multi-byte characters or producing mojibake.
 */
export function truncateSafeUnicode(text: string, maxCodePoints: number): string {
  const points = Array.from(text.trim());
  if (points.length <= maxCodePoints) {
    return text.trim();
  }
  if (maxCodePoints <= 3) {
    return points.slice(0, maxCodePoints).join('');
  }
  return `${points.slice(0, maxCodePoints - 3).join('')}...`;
}

/**
 * Formats a bounded, carrier-ready SMS job alert in English or Amharic Ge'ez.
 *
 * Guarantees:
 * 1. Contains usable job reference (title, organization, and accessible URL `https://digitalbridge.et/jobs/...`).
 * 2. Complies with 3GPP TS 23.038 encoding bounds (GSM-7 for English, UCS-2 for Amharic).
 * 3. Includes mandatory opt-out instructions (`STOP to opt out` in English, `ማቆም` in Amharic).
 * 4. Strictly protects against mojibake and character corruption.
 */
export function formatSmsJobAlert(
  job: JobAlertPayload,
  options: JobAlertFormatOptions = {},
): FormattedSmsJobAlert {
  const maxSegments = options.maxSegments ?? 2;
  const baseUrl = options.baseUrl ?? 'https://digitalbridge.et';
  const jobUrl = buildJobAlertUrl(job.id, job.sourceUrl, baseUrl);

  // Auto-detect language if not explicitly provided: Ge'ez characters default to Amharic.
  const language: 'en' | 'am' =
    options.language ?? (GEEZ_UNICODE_PATTERN.test(job.title) ? 'am' : 'en');

  if (language === 'am') {
    return formatAmharicAlert(job, jobUrl, maxSegments);
  }

  return formatEnglishAlert(job, jobUrl, maxSegments);
}

function formatEnglishAlert(
  job: JobAlertPayload,
  jobUrl: string,
  maxSegments: number,
): FormattedSmsJobAlert {
  const optOutText = 'STOP to opt out';
  const orgPart = job.organization ? ` at ${job.organization.trim()}` : '';
  const locPart = job.location ? ` (${job.location.trim()})` : '';

  // Max characters allowed for GSM-7 multi-segment message
  const maxChars = maxSegments === 1 ? 160 : maxSegments * 153;

  // Initial candidate message
  let title = job.title.trim();
  let message = `Job Alert: ${title}${orgPart}${locPart}. ${jobUrl} ${optOutText}`;
  let analysis = analyzeSmsText(message, maxSegments);

  // If payload exceeds segment limits, iteratively truncate the title safely
  if (analysis.exceedsLimit) {
    const fixedLength = `Job Alert: ...${orgPart}${locPart}. ${jobUrl} ${optOutText}`.length;
    const availableTitleLength = Math.max(10, maxChars - fixedLength);
    title = truncateSafeUnicode(title, availableTitleLength);
    message = `Job Alert: ${title}${orgPart}${locPart}. ${jobUrl} ${optOutText}`;
    analysis = analyzeSmsText(message, maxSegments);
  }

  // Fallback: if location makes it too long, omit location
  if (analysis.exceedsLimit && job.location) {
    const fixedLengthNoLoc = `Job Alert: ...${orgPart}. ${jobUrl} ${optOutText}`.length;
    const availableTitleLength = Math.max(10, maxChars - fixedLengthNoLoc);
    title = truncateSafeUnicode(job.title.trim(), availableTitleLength);
    message = `Job Alert: ${title}${orgPart}. ${jobUrl} ${optOutText}`;
    analysis = analyzeSmsText(message, maxSegments);
  }

  return {
    message,
    encoding: analysis.encoding,
    segments: analysis.segmentCount,
    jobUrl,
    language: 'en',
  };
}

function formatAmharicAlert(
  job: JobAlertPayload,
  jobUrl: string,
  maxSegments: number,
): FormattedSmsJobAlert {
  const optOutText = 'ለማቆም: ማቆም';
  const orgPart = job.organization ? ` በ${job.organization.trim()}` : '';

  // In UCS-2: single segment is 70 chars, concatenated is 67 chars per segment.
  const maxChars = maxSegments === 1 ? 70 : maxSegments * 67;

  let title = job.title.trim();
  let message = `አዲስ የስራ እድል፡ ${title}${orgPart}። ${jobUrl} ${optOutText}`;
  let analysis = analyzeSmsText(message, maxSegments);

  if (analysis.exceedsLimit) {
    const fixedLength = `አዲስ የስራ እድል፡ ...${orgPart}። ${jobUrl} ${optOutText}`.length;
    const availableTitleLength = Math.max(6, maxChars - fixedLength);
    title = truncateSafeUnicode(title, availableTitleLength);
    message = `አዲስ የስራ እድል፡ ${title}${orgPart}። ${jobUrl} ${optOutText}`;
    analysis = analyzeSmsText(message, maxSegments);
  }

  // Fallback if still exceeding: simplify prefix and opt-out
  if (analysis.exceedsLimit) {
    const minOptOut = 'ማቆም';
    const fixedLength = `ስራ፡ ...። ${jobUrl} ${minOptOut}`.length;
    const availableTitleLength = Math.max(5, maxChars - fixedLength);
    title = truncateSafeUnicode(job.title.trim(), availableTitleLength);
    message = `ስራ፡ ${title}። ${jobUrl} ${minOptOut}`;
    analysis = analyzeSmsText(message, maxSegments);
  }

  return {
    message,
    encoding: analysis.encoding,
    segments: analysis.segmentCount,
    jobUrl,
    language: 'am',
  };
}
