import { of } from 'rxjs';
import { SiigoHttpClient } from './siigo-http.client';

function buildHttpServiceMock(responses: Array<{ status: number; data: unknown }>) {
  const request = jest.fn();

  responses.forEach((response) => {
    request.mockImplementationOnce(() => of(response));
  });

  return { request };
}

describe('SiigoHttpClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reintenta con backoff cuando SIIGO responde 429 y devuelve el resultado del intento que sí funciona', async () => {
    const httpService = buildHttpServiceMock([
      { status: 429, data: { message: 'rate limit' } },
      { status: 429, data: { message: 'rate limit' } },
      { status: 200, data: { results: [] } },
    ]);
    const client = new SiigoHttpClient(httpService as any);

    const resultPromise = client.findCustomerByIdentificationAndBranch(
      'token',
      '900123456',
    );

    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(4_000);

    const result = await resultPromise;

    expect(result).toBeNull();
    expect(httpService.request).toHaveBeenCalledTimes(3);
  });

  it('lanza un error si SIIGO responde 429 en todos los intentos', async () => {
    const httpService = buildHttpServiceMock([
      { status: 429, data: {} },
      { status: 429, data: {} },
      { status: 429, data: {} },
      { status: 429, data: {} },
    ]);
    const client = new SiigoHttpClient(httpService as any);

    const resultPromise = client.findCustomerByIdentificationAndBranch(
      'token',
      '900123456',
    );
    const assertion = expect(resultPromise).rejects.toThrow(/429/);

    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(4_000);
    await jest.advanceTimersByTimeAsync(6_000);

    await assertion;
    expect(httpService.request).toHaveBeenCalledTimes(4);
  });

  it('agrega un timeout a cada request para no colgarse indefinidamente', async () => {
    const httpService = buildHttpServiceMock([{ status: 200, data: [] }]);
    const client = new SiigoHttpClient(httpService as any);

    await client.listTaxes('token');

    expect(httpService.request).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it('lanza un error normal (sin reintentos) para estados distintos de 429', async () => {
    const httpService = buildHttpServiceMock([
      { status: 400, data: { message: 'bad request' } },
    ]);
    const client = new SiigoHttpClient(httpService as any);

    await expect(client.listTaxes('token')).rejects.toThrow(/400/);
    expect(httpService.request).toHaveBeenCalledTimes(1);
  });
});
