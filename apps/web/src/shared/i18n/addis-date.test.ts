import { describe, expect, it } from 'vitest';
import { formatAddisDate, type AddisDate } from './addis-date.ts';

const NEW_YEAR = '2026-09-11T12:00:00.000Z';
const PAGUME_END = '2027-09-11T20:59:00.000Z';
const NEXT_NEW_YEAR = '2027-09-11T21:00:00.000Z';

function expected(ethiopian: string, gregorian: string, addisAbabaTime: string): AddisDate {
  return { ethiopian, gregorian, addisAbabaTime };
}

describe('formatAddisDate', () => {
  it.each([
    [
      'English Ethiopian New Year',
      NEW_YEAR,
      'en',
      expected('1 Meskerem 2019', '11 September 2026', '15:00'),
    ],
    [
      'Amharic Ethiopian New Year',
      NEW_YEAR,
      'am',
      expected('1 መስከረም 2019', '11 ሴፕቴምበር 2026', '15:00'),
    ],
  ] as const)('converts %s', (_case, instant, language, result) => {
    expect(formatAddisDate(instant, language)).toEqual(result);
  });

  it('moves to the next local day at Addis Ababa midnight', () => {
    // 20:59:59Z is 23:59:59 in Addis; 21:00Z is the next local day.
    expect(formatAddisDate('2026-09-10T20:59:59.000Z', 'en')).toEqual(
      expected('5 Pagumen 2018', '10 September 2026', '23:59'),
    );
    expect(formatAddisDate('2026-09-10T21:00:00.000Z', 'en')).toEqual(
      expected('1 Meskerem 2019', '11 September 2026', '00:00'),
    );
  });

  it('uses the Ethiopian leap-year boundary before Meskerem 2020', () => {
    // Ethiopian 2019 has six Pagume days, so 2020 starts on 12 September.
    expect(formatAddisDate(PAGUME_END, 'en')).toEqual(
      expected('6 Pagumen 2019', '11 September 2027', '23:59'),
    );
    expect(formatAddisDate(NEXT_NEW_YEAR, 'en')).toEqual(
      expected('1 Meskerem 2020', '12 September 2027', '00:00'),
    );
  });

  it('keeps the same instant for offset and Z inputs', () => {
    expect(formatAddisDate('2026-09-11T15:00:00+03:00', 'en')).toEqual(
      formatAddisDate(NEW_YEAR, 'en'),
    );
  });

  it.each(['2026-09-11T12:00:00', '2026-09-11', 'not-a-date'])(
    'returns null for a value that is not an ISO instant: %s',
    (instant) => {
      expect(formatAddisDate(instant, 'en')).toBeNull();
    },
  );

  it('presents the fixture job deadline in Amharic', () => {
    expect(formatAddisDate(PAGUME_END, 'am')).toEqual(
      expected('6 ጳጉሜን 2019', '11 ሴፕቴምበር 2027', '23:59'),
    );
  });
});
