import {
  convertDayMonthYearToIso,
  endOfColombiaDate,
  matchIsoDate,
  startOfColombiaDate,
} from './date-normalization.helper';

describe('matchIsoDate', () => {
  it('returns the value unchanged when it is an exact ISO date', () => {
    expect(matchIsoDate('2026-06-10')).toBe('2026-06-10');
  });

  it('returns the ISO prefix when the value has a time component', () => {
    expect(matchIsoDate('2026-06-10T09:51:47-05:00')).toBe('2026-06-10');
  });

  it('returns null when the value is not an ISO date', () => {
    expect(matchIsoDate('10/06/2026')).toBeNull();
  });
});

describe('convertDayMonthYearToIso', () => {
  it('converts dd/mm/aaaa to yyyy-mm-dd', () => {
    expect(convertDayMonthYearToIso('10/06/2026')).toBe('2026-06-10');
  });

  it('converts dd-mm-aaaa to yyyy-mm-dd', () => {
    expect(convertDayMonthYearToIso('10-06-2026')).toBe('2026-06-10');
  });

  it('pads single-digit day and month', () => {
    expect(convertDayMonthYearToIso('1/6/2026')).toBe('2026-06-01');
  });

  it('accepts a trailing time component', () => {
    expect(convertDayMonthYearToIso('10/06/2026 14:30:00')).toBe(
      '2026-06-10',
    );
  });

  it('rejects dot separators by default', () => {
    expect(convertDayMonthYearToIso('10.06.2026')).toBeNull();
  });

  it('accepts dot separators when allowDotSeparator is set', () => {
    expect(
      convertDayMonthYearToIso('10.06.2026', { allowDotSeparator: true }),
    ).toBe('2026-06-10');
  });

  it('returns null when the value does not match', () => {
    expect(convertDayMonthYearToIso('not a date')).toBeNull();
  });
});

describe('startOfColombiaDate / endOfColombiaDate', () => {
  it('incluye una creación de las 9pm Colombia dentro del día local, no del UTC', () => {
    const createdAt = new Date('2026-09-26T02:07:24.000Z');

    expect(startOfColombiaDate('2026-09-25').getTime()).toBeLessThanOrEqual(
      createdAt.getTime(),
    );
    expect(endOfColombiaDate('2026-09-25').getTime()).toBeGreaterThanOrEqual(
      createdAt.getTime(),
    );
    expect(endOfColombiaDate('2026-09-25').toISOString()).toBe(
      '2026-09-26T04:59:59.999Z',
    );
  });
});
