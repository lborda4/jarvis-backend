import { toNextPymePartyName } from './nextpyme-party-name.helper';

describe('toNextPymePartyName', () => {
  it('deja el nombre en string para persona jurídica', () => {
    expect(toNextPymePartyName('EMPRESA SAS', 1)).toBe('EMPRESA SAS');
  });

  it('parte el RUT de persona natural y lo deja en un string (nombres primero)', () => {
    expect(toNextPymePartyName('BORDA BELTRAN LAURA SOFIA', 2)).toBe(
      'LAURA SOFIA BORDA BELTRAN',
    );
  });

  it('un solo token de persona natural sigue siendo string, no arreglo', () => {
    expect(toNextPymePartyName('JUAN', 2)).toBe('JUAN');
  });
});
