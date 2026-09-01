import { isSiigoServiceUnavailableError } from './siigo-auth.helper';

describe('isSiigoServiceUnavailableError', () => {
  it('detecta el 503 real reportado por SIIGO (document_query_service caído)', () => {
    const error = new Error(
      'SIIGO respondió con estado 503: {"Status":503,"Errors":[{"Code":"document_query_service","Message":"The Document query service is currently unavailable. Please try in a few minutes","Params":[],"Detail":"Check the API documentation: https://developer.siigo.com/introduction/codigos-de-error/document_query_service"}]}',
    );

    expect(isSiigoServiceUnavailableError(error)).toBe(true);
  });

  it('no confunde un 500 genérico con un 503 de servicio caído', () => {
    expect(
      isSiigoServiceUnavailableError(
        new Error('SIIGO respondió con estado 500: {"Status":500}'),
      ),
    ).toBe(false);
  });

  it('devuelve false para valores que no son Error', () => {
    expect(isSiigoServiceUnavailableError('no es un error')).toBe(false);
    expect(isSiigoServiceUnavailableError(null)).toBe(false);
  });
});
