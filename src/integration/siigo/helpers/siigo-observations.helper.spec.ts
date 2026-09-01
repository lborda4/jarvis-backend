import {
  SIIGO_OBSERVATIONS_MAX_LENGTH,
  truncateSiigoObservations,
} from './siigo-observations.helper';

describe('truncateSiigoObservations', () => {
  it('deja el texto intacto cuando ya cabe en el límite de SIIGO', () => {
    const text = 'CUFE: abc123 - Folio: FE-1';

    expect(truncateSiigoObservations(text)).toBe(text);
  });

  it('trunca a exactamente 1000 caracteres cuando el texto es más largo (caso real reportado: boilerplate legal de autorretención ICA)', () => {
    const longText = 'a'.repeat(5000);

    const result = truncateSiigoObservations(longText);

    expect(result.length).toBe(SIIGO_OBSERVATIONS_MAX_LENGTH);
    expect(result.endsWith('...')).toBe(true);
  });

  it('no trunca un texto de exactamente 1000 caracteres', () => {
    const text = 'a'.repeat(SIIGO_OBSERVATIONS_MAX_LENGTH);

    expect(truncateSiigoObservations(text)).toBe(text);
  });
});
