import { of, throwError } from 'rxjs';
import { NextPymeApiClient } from './nextpyme-api.client';

describe('NextPyme company authentication', () => {
  it.each([undefined, '', '   '])('rejects a missing company token even with a global token (%s)', async token => {
    const { client, httpService } = buildClient({ 'nextPyme.apiToken': 'global-token' });
    await expect(client.listResolutions(undefined, token)).rejects.toThrow('token de NextPyme');
    await expect(client.putConfigResolution({} as any, token)).rejects.toThrow('token de NextPyme');
    await expect(client.fetchMasterTable('taxes', token)).rejects.toThrow('token de NextPyme');
    await expect(client.getInvoiceByCufe('cufe', token)).rejects.toThrow('token de NextPyme');
    await expect(client.createSupportDocument({} as any, token)).rejects.toThrow('token de NextPyme');
    expect(httpService.request).not.toHaveBeenCalled();
    expect(httpService.put).not.toHaveBeenCalled();
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('configures resolutions with the supplied company token', async () => {
    const { client, httpService } = buildClient();
    httpService.put.mockReturnValue(of({ status: 200, data: { success: true } }));
    await client.putConfigResolution({} as any, ' company-a ');
    await client.putConfigResolution({} as any, 'company-b');
    expect(httpService.put.mock.calls.map(call => call[2].headers.Authorization)).toEqual(['Bearer company-a', 'Bearer company-b']);
  });
});

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

  const httpService = { request: jest.fn(), put: jest.fn(), post: jest.fn() };
  const configService = {
    get: jest.fn((key: string) => config[key]),
  };

  const client = new NextPymeApiClient(
    httpService as any,
    configService as any,
  );

  return { client, httpService };
}

describe('NextPymeApiClient.createSupportDocument defaults', () => {
  it.each([undefined, '', '   '])('completa matrícula y código postal vacíos (%s)', async (value) => {
    const { client, httpService } = buildClient();
    httpService.post.mockReturnValue(of({ status: 200, data: { IsValid: 'true' } }));
    const payload = { seller: { name: 'Proveedor', merchant_registration: value, postal_zone_code: value } } as any;
    await client.createSupportDocument(payload, 'company-token');
    expect(httpService.post.mock.calls[0][1].seller).toEqual({ name: 'Proveedor', merchant_registration: '0000000-00', postal_zone_code: '000000' });
    expect(payload.seller.postal_zone_code).toBe(value);
  });

  it('conserva los valores que ya tiene el vendedor', async () => {
    const { client, httpService } = buildClient();
    httpService.post.mockReturnValue(of({ status: 200, data: { IsValid: true } }));
    await client.createSupportDocument({ seller: { merchant_registration: '1234567-89', postal_zone_code: '110111' } } as any, 'company-token');
    expect(httpService.post.mock.calls[0][1].seller).toEqual({ merchant_registration: '1234567-89', postal_zone_code: '110111' });
  });
});

describe('NextPymeApiClient.configureProductionEnvironment', () => {
  it('activa producción usando únicamente el Bearer de la empresa', async () => {
    const { client, httpService } = buildClient({
      'nextPyme.baseUrl': 'https://api.nextpyme.plus/api/ubl2.1/',
    });
    httpService.put.mockReturnValue(of({ status: 200, data: { success: true } }));
    await client.configureProductionEnvironment(' company-token ');
    expect(httpService.put).toHaveBeenCalledWith(
      'https://api.nextpyme.plus/api/ubl2.1/config/environment',
      { type_environment_id: 1 },
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer company-token',
        },
        timeout: 30000,
      }),
    );
  });

  it('no usa el token global si falta el de la empresa', async () => {
    const { client, httpService } = buildClient();
    await expect(client.configureProductionEnvironment(' ')).rejects.toThrow('token');
    expect(httpService.put).not.toHaveBeenCalled();
  });

  it.each([401, 422, 500])('rechaza HTTP %s sin exponer el cuerpo de respuesta', async (status) => {
    const { client, httpService } = buildClient();
    httpService.put.mockReturnValue(of({ status, data: { message: 'private-token' } }));
    await expect(client.configureProductionEnvironment('private-token')).rejects.toThrow(
      'NextPyme no permitió activar el ambiente de producción.',
    );
  });

  it('rechaza una respuesta de negocio fallida aunque sea HTTP 200', async () => {
    const { client, httpService } = buildClient();
    httpService.put.mockReturnValue(of({ status: 200, data: { success: false } }));
    await expect(client.configureProductionEnvironment('company-token')).rejects.toThrow('no permitió');
  });

  it('reporta errores de conexión sin exponer credenciales', async () => {
    const { client, httpService } = buildClient();
    httpService.put.mockReturnValue(throwError(() => new Error('Bearer private-token')));
    await expect(client.configureProductionEnvironment('private-token')).rejects.toThrow(
      'No fue posible activar el ambiente de producción en NextPyme.',
    );
  });
});

describe('NextPymeApiClient.createInvoice', () => {
  const payload = { number: 1, type_document_id: 1, invoice_lines: [] } as any;
  let consoleSpy: jest.SpyInstance;
  beforeEach(() => { consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined); });
  afterEach(() => { consoleSpy.mockRestore(); });

  it('usa el token de cada empresa sin reemplazarlo por el global', async () => {
    const { client, httpService } = buildClient();
    const data = { success: true, ResponseDian: { IsValid: 'true' } };
    httpService.post.mockReturnValue(of({ status: 200, data }));
    await client.createInvoice(payload, ' company-a ');
    await client.createInvoice(payload, 'company-b');
    expect(httpService.post.mock.calls.map((call) => call[2].headers.Authorization))
      .toEqual(['Bearer company-a', 'Bearer company-b']);
    expect(httpService.post.mock.calls[0][0]).toBe('https://nextpyme.example/invoice');
    expect(consoleSpy).toHaveBeenCalledWith('[NextPyme invoice] Body antes de enviar:', JSON.stringify(payload, null, 2));
    expect(consoleSpy).toHaveBeenCalledWith('[NextPyme invoice] Respuesta HTTP 200:', JSON.stringify(data, null, 2));
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('company-a');
  });

  it.each([true, 'true'])('acepta únicamente validación positiva (%s)', async (isValid) => {
    const { client, httpService } = buildClient();
    const data = { success: true, ResponseDian: { Envelope: { Body: { SendBillSyncResponse: { SendBillSyncResult: { isValid } } } } } };
    httpService.post.mockReturnValue(of({ status: 200, data }));
    await expect(client.createInvoice(payload, 'company-token')).resolves.toEqual(data);
  });

  it.each([false, 'false', undefined, null, 'unknown', 1])('rechaza éxito HTTP sin validación positiva (%s)', async (IsValid) => {
    const { client, httpService } = buildClient();
    const data = { success: true, ResponseDian: { IsValid, ErrorMessage: { string: 'Regla: ZB01, Rechazo: Fallo en el Schema XML' } } };
    httpService.post.mockReturnValue(of({ status: 200, data }));
    await expect(client.createInvoice(payload, 'company-token')).rejects.toThrow(
      IsValid === false || IsValid === 'false' ? 'Regla: ZB01' : 'no confirmó IsValid=true',
    );
  });

  it('no hace una llamada con el token global cuando falta el token propio', async () => {
    const { client, httpService } = buildClient();
    await expect(client.createInvoice(payload, ' ')).rejects.toThrow('token');
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it.each([200, 403])('registra la respuesta de membresía y propaga el error HTTP %s', async (status) => {
    const { client, httpService } = buildClient();
    const data = { success: false, message: 'La empresa ha llegado al limite de tiempo/documentos del plan' };
    httpService.post.mockReturnValue(of({ status, data }));
    await expect(client.createInvoice(payload, 'company-token')).rejects.toThrow(data.message);
    expect(consoleSpy).toHaveBeenCalledWith(`[NextPyme invoice] Respuesta HTTP ${status}:`, JSON.stringify(data, null, 2));
  });
});

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
      client.getInvoiceByCufe('cufe-1', 'company-token'),
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
      client.getInvoiceByCufe('cufe-1', 'company-token'),
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
      client.getInvoiceByCufe('cufe-1', 'company-token'),
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
      client.getInvoiceByCufe('cufe-1', 'company-token'),
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
      client.getInvoiceByCufe('cufe-1', 'company-token'),
    );

    // 1 intento + 1 reintento configurado.
    expect(httpService.request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ outcome: 'error', retryable: true });
  });

  it('devuelve not_found sin reintentar cuando NextPyme responde 200 sin datos de factura', async () => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status: 200, data: {} }));

    const result = await runWithFakeTimers(() =>
      client.getInvoiceByCufe('cufe-1', 'company-token'),
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

    const resolutions = await client.listResolutions(undefined, "company-token");

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

    const resolutions = await client.listResolutions(undefined, "company-token");

    expect(resolutions).toEqual([
      expect.objectContaining({ id: 7, type_document_id: 11, number: 42 }),
    ]);
  });
});

describe('NextPymeApiClient.getInvoiceXmlByCufe', () => {
  it.each(['', '   '])('never falls back to the global token when the company token is missing', async companyToken => {
    const { client, httpService } = buildClient({ 'nextPyme.apiToken': 'global-token' });
    await expect(client.getInvoiceXmlByCufe('cufe', companyToken)).rejects.toThrow('La empresa no tiene un token');
    expect(httpService.request).not.toHaveBeenCalled();
  });
  it('works with a company token even without a global token', async () => {
    const { client, httpService } = buildClient({ 'nextPyme.apiToken': undefined });
    httpService.request.mockReturnValue(of({ status: 200, data: '<Invoice/>' }));
    await expect(client.getInvoiceXmlByCufe('cufe', ' company-token ')).resolves.toBe('<Invoice/>');
    expect(httpService.request).toHaveBeenCalledWith(expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer company-token' }) }));
  });

  it.each([
    '<Invoice/>',
    { xml: '<Invoice/>' },
    { data: { xml: Buffer.from('<Invoice/>').toString('base64') } },
  ])('extracts raw or encoded XML and sends an authenticated POST', async (data) => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status: 200, data }));
    await expect(client.getInvoiceXmlByCufe('cufe-123', 'company-token')).resolves.toBe('<Invoice/>');
    expect(httpService.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: 'https://nextpyme.example/xml/document/cufe-123', headers: expect.objectContaining({ Authorization: 'Bearer company-token', Accept: 'application/json' }), timeout: 30000 }));
  });
  it.each([401, 402, 404, 500])('reports upstream HTTP %s without using saved invoice data', async status => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status, data: {} }));
    await expect(client.getInvoiceXmlByCufe('cufe', 'company-token')).rejects.toThrow(`HTTP ${status}`);
  });
  it('rejects a successful JSON response with no XML', async () => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(of({ status: 200, data: { success: false } }));
    await expect(client.getInvoiceXmlByCufe('cufe', 'company-token')).rejects.toThrow('XML');
  });
  it('reports network failure without leaking credentials', async () => {
    const { client, httpService } = buildClient();
    httpService.request.mockReturnValue(throwError(() => new Error('secret')));
    await expect(client.getInvoiceXmlByCufe('cufe', 'company-token')).rejects.toThrow('No se pudo obtener el XML');
  });
});

describe('NextPymeApiClient.createSupportDocument con token de empresa', () => {
  const payload = {
    number: 1, type_document_id: 11, invoice_lines: [],
    seller: { name: 'Proveedor', merchant_registration: '0000000-00', postal_zone_code: '000000' },
  } as any;
  it('usa support-document y el token de la empresa, sin el token global', async () => {
    const { client, httpService } = buildClient();
    const data = { success: true, ResponseDian: { IsValid: 'true' }, cuds: 'support-code' };
    httpService.post.mockReturnValue(of({ status: 200, data }));
    await expect(client.createSupportDocument(payload, ' company-a ')).resolves.toEqual(data);
    expect(httpService.post).toHaveBeenCalledWith('https://nextpyme.example/support-document', payload, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer company-a' }) }));
  });
  it.each([false, 'false', undefined])('no acepta un documento sin validacion positiva (%s)', async (IsValid) => {
    const { client, httpService } = buildClient();
    httpService.post.mockReturnValue(of({ status: 200, data: { success: true, ResponseDian: { IsValid } } }));
    await expect(client.createSupportDocument(payload, 'company-a')).rejects.toThrow();
  });
  it('no envia con un token vacio ni lo reemplaza por el global', async () => {
    const { client, httpService } = buildClient();
    await expect(client.createSupportDocument(payload, ' ')).rejects.toThrow('token');
    expect(httpService.post).not.toHaveBeenCalled();
  });
  it('rechaza success false aunque el servidor responda HTTP 200', async () => {
    const { client, httpService } = buildClient();
    httpService.post.mockReturnValue(of({ status: 200, data: { success: false } }));
    await expect(client.createSupportDocument(payload, 'company-a')).rejects.toThrow();
  });
});

describe('NextPymeApiClient credit-note', () => {
  it('usa endpoint credit-note y token de la empresa', async () => {
    const { client, httpService } = buildClient();
    const response = { success: true, ResponseDian: { IsValid: true } };
    httpService.post.mockReturnValue(of({ status: 200, data: response }));
    await expect(client.createCreditNote({ type_document_id: 4 }, ' company-credit ')).resolves.toEqual(response);
    expect(httpService.post).toHaveBeenCalledWith('https://nextpyme.example/credit-note', { type_document_id: 4 }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer company-credit' }) }));
  });
  it.each([false, undefined])('rechaza respuesta sin confirmacion DIAN (%s)', async IsValid => {
    const { client, httpService } = buildClient();
    httpService.post.mockReturnValue(of({ status: 200, data: { success: true, ResponseDian: { IsValid } } }));
    await expect(client.createCreditNote({}, 'company-token')).rejects.toThrow();
  });
});

describe('NextPymeApiClient debit-note', () => {
  it('usa endpoint debit-note y token de la empresa', async () => {
    const { client, httpService } = buildClient();
    const response = { success: true, ResponseDian: { IsValid: true } };
    httpService.post.mockReturnValue(of({ status: 200, data: response }));
    await expect(client.createDebitNote({ type_document_id: 5 }, ' company-debit ')).resolves.toEqual(response);
    expect(httpService.post).toHaveBeenCalledWith('https://nextpyme.example/debit-note', { type_document_id: 5 }, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer company-debit' }) }));
  });
  it.each([false, undefined])('rechaza respuesta sin confirmacion DIAN (%s)', async IsValid => {
    const { client, httpService } = buildClient();
    httpService.post.mockReturnValue(of({ status: 200, data: { success: true, ResponseDian: { IsValid } } }));
    await expect(client.createDebitNote({}, 'company-token')).rejects.toThrow();
  });
});
