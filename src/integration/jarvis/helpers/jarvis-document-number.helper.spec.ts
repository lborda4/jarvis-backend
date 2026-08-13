import { JarvisDocumentType } from '../enums/jarvis-document-type.enum';
import {
  normalizeJarvisDocumentNumber,
  normalizeJarvisDocumentType,
} from './jarvis-document-number.helper';

describe('normalizeJarvisDocumentNumber', () => {
  it('strips punctuation/spaces and uppercases', () => {
    expect(normalizeJarvisDocumentNumber(' 900.123-456 ')).toBe('900123456');
  });

  it('returns an empty string for null/undefined', () => {
    expect(normalizeJarvisDocumentNumber(undefined)).toBe('');
    expect(normalizeJarvisDocumentNumber(null)).toBe('');
  });
});

describe('normalizeJarvisDocumentType', () => {
  it('recognizes CC/cedula', () => {
    expect(normalizeJarvisDocumentType('CC')).toBe(JarvisDocumentType.CC);
    expect(normalizeJarvisDocumentType('cedula')).toBe(JarvisDocumentType.CC);
  });

  it('recognizes CE/extranjeria', () => {
    expect(normalizeJarvisDocumentType('CE')).toBe(JarvisDocumentType.CE);
    expect(normalizeJarvisDocumentType('extranjeria')).toBe(
      JarvisDocumentType.CE,
    );
  });

  it('recognizes PA/pasaporte', () => {
    expect(normalizeJarvisDocumentType('PA')).toBe(JarvisDocumentType.PA);
    expect(normalizeJarvisDocumentType('pasaporte')).toBe(
      JarvisDocumentType.PA,
    );
  });

  it('defaults to NIT for anything else', () => {
    expect(normalizeJarvisDocumentType('NIT')).toBe(JarvisDocumentType.NIT);
    expect(normalizeJarvisDocumentType(undefined)).toBe(
      JarvisDocumentType.NIT,
    );
    expect(normalizeJarvisDocumentType('xyz')).toBe(JarvisDocumentType.NIT);
  });
});
