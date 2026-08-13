import {
  collectRecords,
  findInRecord,
  normalizeRecordKey,
  normalizeRecordValue,
} from './nextpyme-record-scan.helper';

describe('normalizeRecordKey', () => {
  it('strips accents, punctuation and casing', () => {
    expect(normalizeRecordKey('Número Identificación')).toBe(
      'numeroidentificacion',
    );
    expect(normalizeRecordKey('businessName')).toBe('businessname');
  });
});

describe('normalizeRecordValue', () => {
  it('trims strings and numbers', () => {
    expect(normalizeRecordValue('  hello  ')).toBe('hello');
    expect(normalizeRecordValue(42)).toBe('42');
  });

  it('rejects empty, null-ish and non string/number values', () => {
    expect(normalizeRecordValue('')).toBeNull();
    expect(normalizeRecordValue('null')).toBeNull();
    expect(normalizeRecordValue('NULL')).toBeNull();
    expect(normalizeRecordValue(undefined)).toBeNull();
    expect(normalizeRecordValue({})).toBeNull();
  });
});

describe('collectRecords', () => {
  it('flattens nested objects and arrays into a record list', () => {
    const payload = { a: { b: 1 }, c: [{ d: 2 }, { e: 3 }] };
    const records = collectRecords(payload);

    expect(records).toContainEqual(payload);
    expect(records).toContainEqual({ b: 1 });
    expect(records).toContainEqual({ d: 2 });
    expect(records).toContainEqual({ e: 3 });
  });

  it('does not parse JSON-looking strings by default', () => {
    const records = collectRecords({ a: '{"b":1}' });
    expect(records).toEqual([{ a: '{"b":1}' }]);
  });

  it('parses JSON-looking strings when parseJsonStrings is set', () => {
    const records = collectRecords(
      { a: '{"b":1}' },
      { parseJsonStrings: true },
    );

    expect(records).toContainEqual({ b: 1 });
  });
});

describe('findInRecord', () => {
  it('matches a candidate key regardless of accents/casing', () => {
    expect(
      findInRecord({ 'Razón Social': 'Acme S.A.S.' }, ['razonsocial']),
    ).toBe('Acme S.A.S.');
  });

  it('returns null when no candidate matches or the value is empty', () => {
    expect(findInRecord({ foo: 'bar' }, ['razonsocial'])).toBeNull();
    expect(findInRecord({ razonSocial: '' }, ['razonsocial'])).toBeNull();
  });
});
