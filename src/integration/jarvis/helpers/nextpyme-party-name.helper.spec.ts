import { toNextPymePartyName } from './nextpyme-party-name.helper';

describe('toNextPymePartyName', () => {
  it('deja el nombre en string para persona jurídica', () => {
    expect(toNextPymePartyName('EMPRESA SAS', 1)).toBe('EMPRESA SAS');
  });

  it('parte el RUT de persona natural en nombres y apellidos (DSAJ10a)', () => {
    expect(toNextPymePartyName('BORDA BELTRAN LAURA SOFIA', 2)).toEqual([
      'LAURA SOFIA',
      'BORDA',
      'BELTRAN',
    ]);
  });
});
