import { BadGatewayException, Logger } from '@nestjs/common';
import {
  extractSiigoCalculatedTotalFromApiError,
  handleSiigoApiError,
  isSiigoInvalidTotalPaymentsApiError,
  isSiigoServiceUnavailableApiError,
} from './siigo-error.helper';

function catchWrappedError(rawError: Error): unknown {
  try {
    handleSiigoApiError(
      new Logger('test'),
      rawError,
      'listar facturas de compra',
    );
  } catch (error) {
    return error;
  }

  throw new Error('handleSiigoApiError debería lanzar siempre');
}

describe('isSiigoServiceUnavailableApiError', () => {
  it('detecta un 503/document_query_service después de que handleSiigoApiError lo envuelve', () => {
    const rawError = new Error(
      'SIIGO respondió con estado 503: {"Status":503,"Errors":[{"Code":"document_query_service","Message":"The Document query service is currently unavailable. Please try in a few minutes"}]}',
    );

    const caught = catchWrappedError(rawError);

    expect(caught).toBeInstanceOf(BadGatewayException);
    expect(isSiigoServiceUnavailableApiError(caught)).toBe(true);
  });

  it('no marca como caída de SIIGO un error genérico envuelto', () => {
    const rawError = new Error(
      'SIIGO respondió con estado 400: {"Status":400}',
    );

    expect(isSiigoServiceUnavailableApiError(catchWrappedError(rawError))).toBe(
      false,
    );
  });

  it('devuelve false para errores que no son BadGatewayException', () => {
    expect(isSiigoServiceUnavailableApiError(new Error('otro error'))).toBe(
      false,
    );
    expect(isSiigoServiceUnavailableApiError(null)).toBe(false);
    expect(isSiigoServiceUnavailableApiError(undefined)).toBe(false);
  });
});

// Caso real reportado en producción: SIIGO calculó 5059932.36 (con
// centavos, no pesos enteros) para un ítem de precio entero (4252044) con
// IVA 19%, y rechazó nuestro payments[].value redondeado a 5059932.
const INVALID_TOTAL_PAYMENTS_RAW_ERROR = new Error(
  'SIIGO respondió con estado 400: {"status":400,"errors":[{"code":"invalid_total_payments","message":"The total payments must be equal to the total purchase. The total purchase calculated is 5059932.36","params":["payments"],"detail":"Check the API documentation: https://developer.siigo.com/introduction/codigos-de-error/invalid_total_payments"}]}',
);

describe('isSiigoInvalidTotalPaymentsApiError', () => {
  it('detecta invalid_total_payments después de que handleSiigoApiError lo envuelve', () => {
    const caught = catchWrappedError(INVALID_TOTAL_PAYMENTS_RAW_ERROR);

    expect(caught).toBeInstanceOf(BadGatewayException);
    expect(isSiigoInvalidTotalPaymentsApiError(caught)).toBe(true);
  });

  it('no marca como invalid_total_payments un error genérico envuelto', () => {
    const rawError = new Error(
      'SIIGO respondió con estado 400: {"status":400}',
    );

    expect(
      isSiigoInvalidTotalPaymentsApiError(catchWrappedError(rawError)),
    ).toBe(false);
  });

  it('devuelve false para errores que no son BadGatewayException', () => {
    expect(isSiigoInvalidTotalPaymentsApiError(new Error('otro error'))).toBe(
      false,
    );
    expect(isSiigoInvalidTotalPaymentsApiError(null)).toBe(false);
  });
});

describe('extractSiigoCalculatedTotalFromApiError', () => {
  it('extrae el total exacto (con centavos) del mensaje de SIIGO', () => {
    const caught = catchWrappedError(INVALID_TOTAL_PAYMENTS_RAW_ERROR);

    expect(extractSiigoCalculatedTotalFromApiError(caught)).toBe(5059932.36);
  });

  it('extrae un total en pesos enteros sin decimales', () => {
    const rawError = new Error(
      'SIIGO respondió con estado 400: {"status":400,"errors":[{"code":"invalid_total_payments","message":"The total payments must be equal to the total purchase. The total purchase calculated is 111176","params":["payments"]}]}',
    );

    expect(
      extractSiigoCalculatedTotalFromApiError(catchWrappedError(rawError)),
    ).toBe(111176);
  });

  it('devuelve null si el error no trae ese mensaje', () => {
    const rawError = new Error(
      'SIIGO respondió con estado 400: {"status":400}',
    );

    expect(
      extractSiigoCalculatedTotalFromApiError(catchWrappedError(rawError)),
    ).toBeNull();
  });

  it('devuelve null para errores que no son BadGatewayException', () => {
    expect(extractSiigoCalculatedTotalFromApiError(new Error('x'))).toBeNull();
  });
});
