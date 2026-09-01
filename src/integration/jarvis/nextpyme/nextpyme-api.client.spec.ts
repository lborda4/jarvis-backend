import { of, throwError } from 'rxjs';
import { NextPymeApiClient } from './nextpyme-api.client';

const VALID_NEXTPYME_RESPONSE = {
  data: {
    seller: { identification_number: '900123456' },
    legal_monetary_totals: { payable_amount: '100000' },
    invoice_lines: [],
  },
};

function buildClient(configOverrides: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = {
    'nextPyme.apiToken': 'token',
    'nextPyme.baseUrl': 'https://nextpyme.example',
    'nextPyme.invoiceQueryUrl': 'https://nextpyme.example/return-invoice-data',
    'purchaseInvoiceImport.maxRetries': 2,
    ...configOverrides,
  };

  const httpService = { request: jest.fn() };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  };

  const client = new NextPymeApiClient(
    httpService as any,
    configService as any,
  );

  return { client, httpService };
}

/** Corre `getInvoiceByCufe` con fake timers para no esperar en tiempo real
 * los backoffs (1s/3s/9s...) entre reintentos. */
async function runWithFakeTimers<T>(work: () => Promise<T>): Promise<T> {
  jest.useFakeTimers();
  try {
    const promise = work();
    await jest.runAllTimersAsync();
    return await promise;
  } finally {
    jest.useRealTimers();
  }
}

describe('NextPymeApiClient.getInvoiceByCufe', () => {
  it('no reintenta ante un 400 — la solicitud está mal, reintentarla no cambia el resultado', async () => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status: 400, data: {} }));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1'),
    );

    expect(httpService.request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: 'error',
      status: 400,
      retryable: false,
    });
  });

  it('no reintenta ante un 404', async () => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status: 404, data: {} }));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1'),
    );

    expect(httpService.request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: 'error', retryable: false });
  });

  it('reintenta ante un 503 hasta agotar PURCHASE_INVOICE_IMPORT_MAX_RETRIES y devuelve el último error', async () => {
    const { client, httpService } = buildClient({
      'purchaseInvoiceImport.maxRetries': 2,
    });
    httpService.request.mockReturnValue(of({ status: 503, data: {} }));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1'),
    );

    // 1 intento original + 2 reintentos = 3 llamadas, no 4 (comportamiento
    // anterior con retries fijos) ni 1 (sin retry alguno).
    expect(httpService.request).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({
      outcome: 'error',
      status: 503,
      retryable: true,
      // 3 intentos totales, y el backoff que efectivamente se durmió fue
      // 1000ms (antes del intento 2) + 3000ms (antes del intento 3).
      attempts: 3,
      retryDelayMs: 4000,
    });
  });

  it('se recupera si un reintento posterior a un 503 tiene éxito, sin agotar todos los reintentos', async () => {
    const { client, httpService } = buildClient();
    httpService.request
      .mockReturnValueOnce(of({ status: 503, data: {} }))
      .mockReturnValueOnce(of({ status: 200, data: VALID_NEXTPYME_RESPONSE }));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1'),
    );

    expect(httpService.request).toHaveBeenCalledTimes(2);
    expect(result.outcome).toBe('found');
    expect(result.attempts).toBe(2);
    expect(result.retryDelayMs).toBe(1000);
  });

  it('clasifica un timeout/error de red (sin response) como reintentable', async () => {
    const { client, httpService } = buildClient({
      'purchaseInvoiceImport.maxRetries': 1,
    });
    const timeoutError = Object.assign(
      new Error('timeout of 20000ms exceeded'),
      {
        isAxiosError: true,
        code: 'ECONNABORTED',
      },
    );
    httpService.request.mockReturnValue(throwError(() => timeoutError));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1'),
    );

    // 1 intento + 1 reintento configurado.
    expect(httpService.request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ outcome: 'error', retryable: true });
  });

  it('devuelve not_found sin reintentar cuando NextPyme responde 200 sin datos de factura', async () => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status: 200, data: {} }));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1'),
    );

    expect(httpService.request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      outcome: 'not_found',
      attempts: 1,
      retryDelayMs: 0,
    });
  });
});
