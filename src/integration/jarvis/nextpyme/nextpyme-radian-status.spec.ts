import { of, throwError } from 'rxjs';
import { NextPymeApiClient } from './nextpyme-api.client';
import { parseInvoiceRadianStatus } from './nextpyme-radian-status';
import { JarvisRadianService } from '../jarvis-radian.service';

const cufe = 'a'.repeat(96);

it.each(['033', '034'])('detecta aceptación %s consultada en NextPyme', code => {
  expect(parseInvoiceRadianStatus({ success: true, ResponseDian: { Envelope: { Body: { GetStatusEventResponse: { GetStatusEventResult: { DianResponse: { EventCode: code, IsValid: 'true' } } } } } } })).toEqual({ accepted: true, eventCodes: [code] });
});

it.each([4, 5])('reconoce el id de aceptación %s del proveedor', event_id => {
  expect(parseInvoiceRadianStatus({ success: true, events: [{ event_id }] })?.accepted).toBe(true);
});

it('lee los códigos de los ApplicationResponse en XML base64', () => {
  const xml = '<ApplicationResponse xmlns:cbc="urn:cbc" xmlns:cac="urn:cac"><cac:DocumentResponse><cac:Response><cbc:ResponseCode>034</cbc:ResponseCode></cac:Response></cac:DocumentResponse></ApplicationResponse>';
  expect(parseInvoiceRadianStatus({ ResponseDian: { GetStatusEventResult: { DianResponse: { IsValid: 'true', XmlBase64Bytes: Buffer.from(xml).toString('base64') } } } })?.accepted).toBe(true);
});

it.each([
  { success: true, events: [] },
  { ResponseDian: { GetStatusEventResult: { DianResponse: [] } } },
  { success: true, events: [{ EventCode: '030' }, { EventCode: '032' }] },
  { success: true, events: [{ EventCode: '033', IsValid: 'false' }] },
])('permite una respuesta confirmada sin aceptación: %j', payload => {
  expect(parseInvoiceRadianStatus(payload)?.accepted).toBe(false);
});

it.each([
  null, {}, { success: true }, { success: false, events: [] },
  { ResponseDian: { Fault: { message: 'Error' } }, events: [] },
  { events: [{ event_id: 4, status: 'unknown' }] },
  { events: [{ message: 'No se pudo consultar' }] },
  { events: ['desconocido'] },
  { events: null },
  { events: [], StatusCode: '99' },
  { events: [{ XmlBase64Bytes: 'invalid' }] },
  { events: [{ XmlBase64Bytes: Buffer.from('<ApplicationResponse><ResponseCode>030</ResponseCode>').toString('base64') }] },
])('no confunde una consulta incompleta con ausencia de aceptación: %j', payload => {
  expect(parseInvoiceRadianStatus(payload)).toBeNull();
});

function setupClient() {
  const http = { post: jest.fn().mockReturnValue(of({ status: 200, data: { success: true, events: [] } })) };
  const config = { get: jest.fn(key => key === 'nextPyme.baseUrl' ? 'https://nextpyme.example' : undefined) };
  return { client: new NextPymeApiClient(http as never, config as never), http };
}

it('consulta el endpoint de eventos con el CUFE normalizado y token de la empresa', async () => {
  const { client, http } = setupClient();
  await expect(client.getInvoiceRadianStatus(` ${cufe.toUpperCase()} `, ' company-token ')).resolves.toEqual({ accepted: false, eventCodes: [] });
  expect(http.post).toHaveBeenCalledWith(`https://nextpyme.example/status/events-document/${cufe}`, {}, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer company-token' }), timeout: 20000 }));
});

it.each([401, 429, 500])('bloquea la consulta con HTTP %s aunque el cuerpo parezca vacío', async status => {
  const { client, http } = setupClient();
  http.post.mockReturnValue(of({ status, data: { success: true, events: [] } }));
  await expect(client.getInvoiceRadianStatus(cufe, 'token')).rejects.toThrow('NextPyme');
});

it('bloquea timeouts, cuerpos desconocidos y tokens ausentes sin exponer el token', async () => {
  const { client, http } = setupClient();
  await expect(client.getInvoiceRadianStatus(cufe, ' ')).rejects.toThrow('token');
  expect(http.post).not.toHaveBeenCalled();
  http.post.mockReturnValue(throwError(() => new Error('private-token')));
  await expect(client.getInvoiceRadianStatus(cufe, 'private-token')).rejects.toThrow('No se pudo verificar');
  http.post.mockReturnValue(of({ status: 200, data: { success: true } } as never));
  await expect(client.getInvoiceRadianStatus(cufe, 'token')).rejects.toThrow('No se pudo verificar');
});

it('la elegibilidad usa NextPyme y no consulta el historial local de Jarvis', async () => {
  const companies = { findById: jest.fn().mockResolvedValue({ nextPymeToken: ' owner-token ' }) };
  const integrations = { findByCompanyAndProvider: jest.fn().mockResolvedValue({ subscriptionStatus: 'ACTIVE' }) };
  const client = { getInvoiceRadianStatus: jest.fn().mockResolvedValue({ accepted: true, eventCodes: ['033'] }) };
  const events = { list: jest.fn() };
  const service = new JarvisRadianService(companies as never, integrations as never, client as never, events as never);
  await expect(service.noteEligibility('owner', cufe)).resolves.toMatchObject({ source: 'nextpyme', allowed: false, blockReason: expect.stringContaining('aceptación en RADIAN') });
  expect(companies.findById).toHaveBeenCalledWith('owner');
  expect(client.getInvoiceRadianStatus).toHaveBeenCalledWith(cufe, 'owner-token');
  expect(events.list).not.toHaveBeenCalled();
  integrations.findByCompanyAndProvider.mockResolvedValue(null);
  client.getInvoiceRadianStatus.mockClear();
  await expect(service.noteEligibility('other', cufe)).rejects.toThrow('integración activa');
  expect(client.getInvoiceRadianStatus).not.toHaveBeenCalled();
});

it.each([
  [401, 'RADIAN_AUTH'], [403, 'RADIAN_AUTH'], [404, 'RADIAN_UNAVAILABLE'],
  [429, 'RADIAN_RATE_LIMIT'], [503, 'RADIAN_UNAVAILABLE'],
])('distingue HTTP %s sin permitir la nota ni exponer datos privados', async (status, code) => {
  const { client, http } = setupClient();
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  http.post.mockReturnValue(of({ status, data: { message: 'private-token', events: [] } }));
  const error = await client.getInvoiceRadianStatus(cufe, 'private-token').catch(error => error);
  expect(error.getResponse()).toMatchObject({ statusCode: 502, code });
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
  expect(JSON.stringify(log.mock.calls)).not.toContain(cufe);
});

it('distingue el timeout y registra solo la estructura de una respuesta desconocida', async () => {
  const { client, http } = setupClient();
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  http.post.mockReturnValue(throwError(() => ({ isAxiosError: true, code: 'ECONNABORTED', message: 'private-token' })));
  let error = await client.getInvoiceRadianStatus(cufe, 'private-token').catch(error => error);
  expect(error.getResponse()).toMatchObject({ code: 'RADIAN_TIMEOUT' });
  http.post.mockReturnValue(of({ status: 200, data: { ResponseDian: { unknown: 'private-token' } } } as never));
  error = await client.getInvoiceRadianStatus(cufe, 'private-token').catch(error => error);
  expect(error.getResponse()).toMatchObject({ code: 'RADIAN_RESPONSE' });
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining('body.ResponseDian.unknown'));
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-token');
});

it('registra el motivo del proveedor solo en el servidor y oculta credenciales', async () => {
  const { client, http } = setupClient();
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  http.post.mockReturnValue(of({ status: 422, data: { message: 'Certificado vencido; token=private-token', password: 'private-password' } } as never));
  const error = await client.getInvoiceRadianStatus(cufe, 'private-token').catch(error => error);
  expect(log).toHaveBeenLastCalledWith(expect.stringContaining('Certificado vencido'));
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-token|private-password/);
  expect(JSON.stringify(error.getResponse())).not.toContain('Certificado vencido');
});

function noEventsResponse(statusCode: unknown = '67') {
  return {
    success: true, message: 'Consulta de eventos generada con exito', events: [],
    ResponseDian: { Envelope: {
      Header: { Action: { _attributes: { mustUnderstand: '1' }, _value: 'GetStatusEventResponse' } },
      Body: { GetStatusEventResponse: { GetStatusEventResult: {
        IsValid: 'false', StatusCode: statusCode,
        StatusDescription: 'EL CUFE o Factura consultada no tiene a la fecha eventos asociados.',
        DianResponse: null,
      } } },
    } },
  };
}

it.each(['67', 67, { _value: '67' }])('reconoce la consulta sin eventos con código DIAN %j', code => {
  expect(parseInvoiceRadianStatus(noEventsResponse(code))).toEqual({ accepted: false, eventCodes: [] });
});

it('permite crear la nota cuando NextPyme confirma HTTP 200 y código 67 sin eventos', async () => {
  const { client, http } = setupClient();
  http.post.mockReturnValue(of({ status: 200, data: noEventsResponse() } as never));
  await expect(client.getInvoiceRadianStatus(cufe, 'token')).resolves.toEqual({ accepted: false, eventCodes: [] });
});

it.each(['99', '66', undefined])('mantiene bloqueados otros errores o respuestas incompletas: %j', code => {
  const body = noEventsResponse();
  body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult.StatusCode = code;
  expect(parseInvoiceRadianStatus(body)).toBeNull();
});

it('no confunde el código 67 aislado ni una consulta fallida con una confirmación', () => {
  expect(parseInvoiceRadianStatus({ success: true, events: [], StatusCode: '67' })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), success: false })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), events: null })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), events: [{ status: 'unknown' }] })).toBeNull();
});

it.each([4, 5])('mantiene bloqueada la aceptación %s aunque venga un resultado 67 contradictorio', event_id => {
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), events: [{ event_id }] })?.accepted).not.toBe(false);
});
