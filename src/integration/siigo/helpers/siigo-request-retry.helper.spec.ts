import { BadGatewayException, Logger } from '@nestjs/common';
import { SiigoAuthService } from '../siigo-auth.service';
import { executeSiigoRequestWithRetries } from './siigo-request-retry.helper';
import * as siigoAuthHelper from './siigo-auth.helper';

jest.mock('./siigo-auth.helper', () => {
  const actual = jest.requireActual('./siigo-auth.helper');

  return { ...actual, sleep: jest.fn().mockResolvedValue(undefined) };
});

function build503Error(): Error {
  return new Error(
    'SIIGO respondió con estado 503: {"Status":503,"Errors":[{"Code":"document_query_service","Message":"The Document query service is currently unavailable. Please try in a few minutes"}]}',
  );
}

function build429Error(): Error {
  return new Error(
    'SIIGO respondió con estado 429: {"Status":429,"Errors":[{"Code":"requests_limit","Message":"Too many requests"}]}',
  );
}

function buildAuthServiceStub(): SiigoAuthService {
  return {
    getValidAuthContext: jest
      .fn()
      .mockResolvedValue({ accessToken: 'token', partnerId: undefined }),
    forceRefreshAuthContext: jest.fn(),
  } as unknown as SiigoAuthService;
}

describe('executeSiigoRequestWithRetries — 503 de SIIGO (document_query_service caído)', () => {
  it('reintenta un 503 y devuelve el resultado si un reintento funciona', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(build503Error())
      .mockResolvedValueOnce('ok');

    const result = await executeSiigoRequestWithRetries(
      buildAuthServiceStub(),
      'company-1',
      new Logger('test'),
      'listar facturas de compra',
      request,
    );

    expect(result).toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reintenta exactamente 2 veces y después se rinde con un BadGatewayException', async () => {
    const request = jest.fn().mockRejectedValue(build503Error());

    await expect(
      executeSiigoRequestWithRetries(
        buildAuthServiceStub(),
        'company-1',
        new Logger('test'),
        'listar facturas de compra',
        request,
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    // 1 intento inicial + 2 reintentos = 3 llamadas.
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('executeSiigoRequestWithRetries — 429 de SIIGO (rate limit): backoff exponencial', () => {
  beforeEach(() => {
    jest.mocked(siigoAuthHelper.sleep).mockClear();
  });

  it('reintenta un 429 y devuelve el resultado si un reintento funciona', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(build429Error())
      .mockResolvedValueOnce('ok');

    const result = await executeSiigoRequestWithRetries(
      buildAuthServiceStub(),
      'company-1',
      new Logger('test'),
      'crear tercero',
      request,
    );

    expect(result).toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('espera el doble en cada reintento (1s, 2s, 4s, 8s) en vez de un delay fijo', async () => {
    const request = jest.fn().mockRejectedValue(build429Error());

    await expect(
      executeSiigoRequestWithRetries(
        buildAuthServiceStub(),
        'company-1',
        new Logger('test'),
        'crear tercero',
        request,
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);

    // 1 intento inicial + 4 reintentos = 5 llamadas.
    expect(request).toHaveBeenCalledTimes(5);
    expect(jest.mocked(siigoAuthHelper.sleep).mock.calls.map((call) => call[0])).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });
});
