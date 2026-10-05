import {
  createDefaultSiigoCreditNoteNumbering,
  ensureSiigoCreditNoteNumbering,
  getSiigoCreditNoteNextNumber,
  normalizeSiigoCreditNoteNumbering,
} from './siigo-credit-note-numbering.helper';

describe('siigo-credit-note-numbering.helper', () => {
  it('crea numeración soft desde 1 con prefijo NC', () => {
    expect(createDefaultSiigoCreditNoteNumbering()).toEqual({
      prefix: 'NC',
      fromNumber: 1,
      toNumber: 9_999_999,
      nextConsecutive: 1,
    });
  });

  it('normaliza y asegura el contador persistido', () => {
    expect(
      normalizeSiigoCreditNoteNumbering({
        prefix: ' NC ',
        next_consecutive: 4,
        from_number: 1,
        to_number: 100,
      }),
    ).toEqual({
      prefix: 'NC',
      fromNumber: 1,
      toNumber: 100,
      nextConsecutive: 4,
    });

    expect(
      ensureSiigoCreditNoteNumbering({
        username: 'u',
        access_key: 'k',
      }),
    ).toEqual(createDefaultSiigoCreditNoteNumbering());
  });

  it('detecta rango agotado', () => {
    expect(
      getSiigoCreditNoteNextNumber({
        prefix: 'NC',
        fromNumber: 1,
        toNumber: 2,
        nextConsecutive: 3,
      }),
    ).toBeNull();
  });
});
