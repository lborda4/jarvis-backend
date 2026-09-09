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

/** Respuesta real de GET /reports/resolutions: el sobre crudo de la DIAN,
 * sin id/type_document_id/number. La de documento soporte (DSJ) viene con
 * TechnicalKey en null. */
const DIAN_NUMBERING_RANGE_RESPONSE = {
  success: true,
  message: 'Consulta generada con éxito',
  ResponseDian: {
    Envelope: {
      Body: {
        GetNumberingRangeResponse: {
          GetNumberingRangeResult: {
            OperationCode: '100',
            ResponseList: {
              NumberRangeResponse: [
                {
                  ResolutionNumber: '18764113677707',
                  ResolutionDate: '2026-08-05',
                  Prefix: 'DSJ',
                  FromNumber: '1',
                  ToNumber: '10000',
                  ValidDateFrom: '2026-08-05',
                  ValidDateTo: '2028-08-05',
                  TechnicalKey: null,
                },
                {
                  ResolutionNumber: '18764113677438',
                  ResolutionDate: '2026-08-05',
                  Prefix: 'FVJ',
                  FromNumber: '1',
                  ToNumber: '10000',
                  ValidDateFrom: '2026-08-05',
                  ValidDateTo: '2028-08-05',
                  TechnicalKey: 'a2e4cf48298098fdd401d2e03b14ae13a048c58b',
                },
              ],
            },
          },
        },
      },
    },
  },
};

describe('NextPymeApiClient.listResolutions', () => {
  function buildClientWithGet(data: unknown) {
    const { client } = buildClient();
    const httpGet = jest.fn().mockReturnValue(of({ status: 200, data }));
    (client as any).httpService = { get: httpGet };
    return { client, httpGet };
  }

  it('lee el sobre DIAN, que no trae id ni type_document_id', async () => {
    const { client } = buildClientWithGet(DIAN_NUMBERING_RANGE_RESPONSE);

    const resolutions = await client.listResolutions();

    expect(resolutions).toHaveLength(2);
    expect(resolutions[0]).toMatchObject({
      prefix: 'DSJ',
      resolution: '18764113677707',
      from: 1,
      to: 10000,
      date_from: '2026-08-05',
      date_to: '2028-08-05',
    });
    // Documento soporte no lleva clave técnica.
    expect(resolutions[0].technical_key).toBeUndefined();
    expect(resolutions[1].technical_key).toBe(
      'a2e4cf48298098fdd401d2e03b14ae13a048c58b',
    );
  });

  it('sigue leyendo el formato de lista propio de NextPyme', async () => {
    const { client } = buildClientWithGet({
      data: [
        {
          id: 7,
          type_document_id: 11,
          prefix: 'DSJ',
          number: 42,
          resolution: '18764113677707',
        },
      ],
    });

    const resolutions = await client.listResolutions();

    expect(resolutions).toEqual([
      expect.objectContaining({ id: 7, type_document_id: 11, number: 42 }),
    ]);
  });
});
