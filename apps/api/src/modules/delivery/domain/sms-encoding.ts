// SMS character set analysis, length counting, and segmentation limits.
// Implements 3GPP TS 23.038 / GSM 03.38 standard character sets:
// - GSM-7 basic alphabet (160 chars single, 153 per segment concatenated)
// - GSM-7 extension table characters (each counts as 2 septets)
// - UCS-2 Unicode fallback for Amharic Ge'ez script, emojis, and non-GSM characters
//   (70 chars single, 67 per segment concatenated)

/** Standard GSM 7-bit basic character set. */
const GSM_7_BASIC = new Set([
  '@',
  '£',
  '$',
  '¥',
  'è',
  'é',
  'ù',
  'ì',
  'ò',
  'Ç',
  '\n',
  'Ø',
  'ø',
  '\r',
  'Å',
  'å',
  'Δ',
  '_',
  'Φ',
  'Γ',
  'Λ',
  'Ω',
  'Π',
  'Ψ',
  'Σ',
  'Θ',
  'Ξ',
  '\x1b',
  'Æ',
  'æ',
  'ß',
  'É',
  ' ',
  '!',
  '"',
  '#',
  '¤',
  '%',
  '&',
  "'",
  '(',
  ')',
  '*',
  '+',
  ',',
  '-',
  '.',
  '/',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '¡',
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'Ä',
  'Ö',
  'Ñ',
  'Ü',
  '§',
  '¿',
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  'ä',
  'ö',
  'ñ',
  'ü',
  'à',
]);

/** Standard GSM 7-bit extension characters. Each requires an escape septet, counting as 2 units. */
const GSM_7_EXTENSION = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€', '\f']);

export type SmsEncoding = 'GSM-7' | 'UCS-2';

export interface SmsTextAnalysis {
  /** Detected character encoding. */
  readonly encoding: SmsEncoding;
  /** True if the message contains Unicode characters requiring UCS-2 (e.g. Amharic Ge'ez or emoji). */
  readonly hasUnicode: boolean;
  /**
   * Effective billable character count:
   * For GSM-7, extension characters count as 2.
   * For UCS-2, measured in 16-bit code units.
   */
  readonly characterCount: number;
  /** Number of SMS segments needed to deliver this message. */
  readonly segmentCount: number;
  /** Single message limit for the detected encoding (160 for GSM-7, 70 for UCS-2). */
  readonly singleMessageLimit: number;
  /** Concatenated segment capacity (153 for GSM-7, 67 for UCS-2). */
  readonly concatenatedSegmentLimit: number;
  /** Maximum segments allowed for this dispatch. */
  readonly maxSegmentsAllowed: number;
  /** True if segment count exceeds the configured maximum. */
  readonly exceedsLimit: boolean;
  /** Actionable error reason when limits are exceeded. */
  readonly rejectionReason?: string | undefined;
}

/** Default maximum segmentation limit for Ethiopian telecom routes. */
export const DEFAULT_MAX_SMS_SEGMENTS = 4;

/**
 * Analyzes SMS text to determine encoding, effective character count,
 * segment split count, and whether it satisfies provider segmentation bounds.
 */
export function analyzeSmsText(
  text: string,
  maxSegments: number = DEFAULT_MAX_SMS_SEGMENTS,
): SmsTextAnalysis {
  if (!text || text.length === 0) {
    return {
      encoding: 'GSM-7',
      hasUnicode: false,
      characterCount: 0,
      segmentCount: 0,
      singleMessageLimit: 160,
      concatenatedSegmentLimit: 153,
      maxSegmentsAllowed: maxSegments,
      exceedsLimit: true,
      rejectionReason: 'SMS message body cannot be empty',
    };
  }

  // Determine if text can be represented entirely in GSM-7.
  let isGsm7 = true;
  let gsmSeptetCount = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (GSM_7_EXTENSION.has(char)) {
      gsmSeptetCount += 2;
    } else if (GSM_7_BASIC.has(char)) {
      gsmSeptetCount += 1;
    } else {
      isGsm7 = false;
      break;
    }
  }

  if (isGsm7) {
    const singleLimit = 160;
    const concatLimit = 153;
    const segmentCount =
      gsmSeptetCount <= singleLimit ? 1 : Math.ceil(gsmSeptetCount / concatLimit);
    const exceedsLimit = segmentCount > maxSegments;

    return {
      encoding: 'GSM-7',
      hasUnicode: false,
      characterCount: gsmSeptetCount,
      segmentCount,
      singleMessageLimit: singleLimit,
      concatenatedSegmentLimit: concatLimit,
      maxSegmentsAllowed: maxSegments,
      exceedsLimit,
      ...(exceedsLimit
        ? {
            rejectionReason: `Message exceeds maximum GSM-7 segmentation limit of ${maxSegments} parts (requires ${segmentCount} parts)`,
          }
        : {}),
    };
  }

  // UCS-2 (Unicode) encoding (used for Amharic, emoji, and special symbols).
  const ucs2CharCount = text.length;
  const singleLimit = 70;
  const concatLimit = 67;
  const segmentCount = ucs2CharCount <= singleLimit ? 1 : Math.ceil(ucs2CharCount / concatLimit);
  const exceedsLimit = segmentCount > maxSegments;

  return {
    encoding: 'UCS-2',
    hasUnicode: true,
    characterCount: ucs2CharCount,
    segmentCount,
    singleMessageLimit: singleLimit,
    concatenatedSegmentLimit: concatLimit,
    maxSegmentsAllowed: maxSegments,
    exceedsLimit,
    ...(exceedsLimit
      ? {
          rejectionReason: `Message exceeds maximum UCS-2 Unicode segmentation limit of ${maxSegments} parts (requires ${segmentCount} parts)`,
        }
      : {}),
  };
}
