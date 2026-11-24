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
  expect(parseInvoiceRadianStatus({ success: false, events: [] })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), events: null })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), events: [{ status: 'unknown' }] })).toBeNull();
});

it.each([4, 5])('mantiene bloqueada la aceptación %s aunque venga un resultado 67 contradictorio', event_id => {
  expect(parseInvoiceRadianStatus({ ...noEventsResponse(), events: [{ event_id }] })?.accepted).not.toBe(false);
});

function nestedNoEventsResponse(statusCode: unknown = '67') {
  const body = noEventsResponse();
  const result = body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult;
  return { ...body, ResponseDian: { Envelope: {
    ...body.ResponseDian.Envelope,
    Body: { GetStatusEventResponse: { GetStatusEventResult: { DianResponse: {
      IsValid: { _value: 'false' }, StatusCode: { _value: statusCode },
      StatusDescription: { _value: result.StatusDescription },
      ErrorMessage: { string: { _value: result.StatusDescription } },
    } } } },
  } } };
}

it('reproduce el 502 con el resultado DIAN dentro de GetStatusEventResult.DianResponse', async () => {
  const { client, http } = setupClient();
  http.post.mockReturnValue(of({ status: 200, data: nestedNoEventsResponse() } as never));
  await expect(client.getInvoiceRadianStatus(cufe, 'token')).resolves.toEqual({ accepted: false, eventCodes: [] });
});

it.each([{}, { _attributes: { nil: 'true' } }])('tolera un DianResponse vacío %j cuando el resultado 67 ya confirmó ausencia de eventos', empty => {
  const body = noEventsResponse();
  const result = { ...body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult, DianResponse: empty };
  expect(parseInvoiceRadianStatus({ ...body, ResponseDian: { GetStatusEventResult: result } })).toEqual({ accepted: false, eventCodes: [] });
});

it('lee el resultado anidado con namespaces y sobres SOAP serializados como JSON', () => {
  const body = nestedNoEventsResponse();
  const result = body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult.DianResponse;
  expect(parseInvoiceRadianStatus({ ...body, ResponseDian: JSON.stringify({ 's:Envelope': { 's:Body': { 'a:GetStatusEventResponse': { 'a:GetStatusEventResult': { 'a:DianResponse': result } } } } }) })).toEqual({ accepted: false, eventCodes: [] });
});

it.each(['99', '66', undefined])('no habilita la nota ante un fallo DIAN anidado %j', code => {
  const body = nestedNoEventsResponse();
  body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult.DianResponse.StatusCode._value = code;
  expect(parseInvoiceRadianStatus(body)).toBeNull();
});

it.each([4, 5])('no habilita la nota si hay aceptación %s o falla explícita junto al código 67 anidado', event_id => {
  expect(parseInvoiceRadianStatus({ ...nestedNoEventsResponse(), events: [{ event_id }] })?.accepted).not.toBe(false);
  expect(parseInvoiceRadianStatus({ ...nestedNoEventsResponse(), success: false, message: 'Error de autenticación' })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...nestedNoEventsResponse(), events: [{ status: 'unknown' }] })).toBeNull();
});

it('imprime la respuesta completa protegida cuando falla la lectura y mantiene el bloqueo', async () => {
  const { client, http } = setupClient();
  const log = jest.spyOn(console, 'warn').mockImplementation(() => {});
  log.mockClear();
  const body = { success: true, events: [], ResponseDian: { Result: { StatusCode: '67' } }, token: 'private-token' };
  http.post.mockReturnValue(of({ status: 200, data: body } as never));
  await expect(client.getInvoiceRadianStatus(cufe, 'private-token')).rejects.toThrow('No se pudo verificar');
  const entry = log.mock.calls.find(call => String(call[0]).startsWith('[radian/note-eligibility:nextpyme-response]'));
  expect(entry).toBeDefined();
  const snapshot = JSON.parse(String(entry![0]).slice('[radian/note-eligibility:nextpyme-response] '.length));
  expect(snapshot.parserVersion).toBe('2026-11-23.4');
  expect(snapshot.response.responsedian.result.statuscode).toBe('67');
  expect(snapshot.response.events.arrayLength).toBe(0);
  expect(JSON.stringify(snapshot)).not.toContain('private-token');
});

// Response supplied from the real failing NextPyme call: preserve flags, nil wrappers and XML fields.
function realNoEventsResponse() {
  return {
    success: false,
    message: 'Consulta de eventos generada con exito ',
    events: [],
    ResponseDian: { Envelope: {
      Header: {
        Action: { _attributes: { mustUnderstand: '1' }, _value: 'http://wcf.dian.colombia/IWcfDianCustomerServices/GetStatusEventResponse' },
        Security: { _attributes: { mustUnderstand: '1' }, Timestamp: { _attributes: { Id: '_0' }, Created: '2026-11-23T23:58:12.380Z', Expires: '2026-11-24T00:03:12.380Z' } },
      },
      Body: { GetStatusEventResponse: { GetStatusEventResult: {
        ErrorMessage: [], IsValid: 'false', StatusCode: '67',
        StatusDescription: 'EL CUFE o Factura consultada no tiene a la fecha eventos asociados.',
        StatusMessage: { _attributes: { nil: 'true' } },
        XmlBase64Bytes: 'PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiIHN0YW5kYWxvbmU9Im5vIj8+PEFwcGxpY2F0aW9uUmVzcG9uc2UgeG1sbnM6Y2FjPSJ1cm46b2FzaXM6bU+DQogICAgICA8L2NhYzpUYXhTY2hlbWU+DQogICAgPC9jYWM6UGFydHlUYXhTY2hlbWU+DQogIDwvY2FjOlJlY2VpdmVyUGFydHk+DQo8L0FwcGxpY2F0aW9uUmVzcG9uc2U+',
        XmlBytes: { _attributes: { nil: 'true' } },
        XmlDocumentKey: cufe, XmlFileName: 'fv-test',
      } } },
    } },
    cufecude: cufe, certificate_days_left: 239,
  };
}

it('reproduce la respuesta real: success false con DIAN 67, eventos vacíos y XML no significa error', () => {
  expect(parseInvoiceRadianStatus(realNoEventsResponse())).toEqual({ accepted: false, eventCodes: [] });
});

it('devuelve allowed true para la respuesta real a través del cliente y servicio usados por el frontend', async () => {
  const { client, http } = setupClient();
  http.post.mockReturnValue(of({ status: 200, data: realNoEventsResponse() } as never));
  const service = new JarvisRadianService(
    { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'owner-token' }) } as never,
    { findByCompanyAndProvider: jest.fn().mockResolvedValue({ subscriptionStatus: 'ACTIVE' }) } as never,
    client, {} as never,
  );
  await expect(service.noteEligibility('owner', cufe)).resolves.toEqual({ source: 'nextpyme', allowed: true, blockReason: null });
});

it.each([401, 403, 429, 500])('no permite la nota con HTTP %s aunque el cuerpo sea el caso 67 real', async status => {
  const { client, http } = setupClient();
  http.post.mockReturnValue(of({ status, data: realNoEventsResponse() } as never));
  await expect(client.getInvoiceRadianStatus(cufe, 'token')).rejects.toThrow('No se pudo verificar');
});

it.each([
  { success: false, events: [] },
  { ...realNoEventsResponse(), message: 'Unauthenticated' },
  { ...realNoEventsResponse(), events: [{ event_id: 4 }] },
  { ...realNoEventsResponse(), events: [{ event_id: 5 }] },
  { ...realNoEventsResponse(), events: [{ status: 'unknown' }] },
  { ...realNoEventsResponse(), events: null },
])('mantiene el bloqueo ante fallos o eventos contradictorios en una respuesta success false: %#', payload => {
  expect(parseInvoiceRadianStatus(payload)?.accepted).not.toBe(false);
});

it.each(['99', '66', undefined])('no convierte success false y otro código DIAN %j en ausencia de eventos', code => {
  const body = realNoEventsResponse();
  const result = { ...body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult, StatusCode: code };
  expect(parseInvoiceRadianStatus({ ...body, ResponseDian: { GetStatusEventResult: result } })).toBeNull();
});

it('mantiene el bloqueo si existe una falla adicional aunque haya código 67', () => {
  const body = realNoEventsResponse();
  const result = { ...body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult, ErrorMessage: ['Certificado vencido'] };
  expect(parseInvoiceRadianStatus({ ...body, ResponseDian: { GetStatusEventResult: result } })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...body, ok: false })).toBeNull();
  expect(parseInvoiceRadianStatus({ ...body, ResponseDian: { ...body.ResponseDian, Fault: { message: 'Error' } } })).toBeNull();
});

function realEventsResponse() {
  const body = realNoEventsResponse();
  return { ...body, success: true,
    events: [
      { event_number: '1', dian_code: '030', description: 'Acuse de recibo de Factura Electrónica de Venta', date: '2025-06-17', time: '16:39:59-05:00', cude: 'b'.repeat(96) },
      { event_number: '2', dian_code: '032', description: 'Recibo del bien o prestación del servicio', date: '2025-07-01', time: '06:56:14-05:00', cude: 'c'.repeat(96) },
      { event_number: '3', dian_code: '034', description: 'Aceptación Tácita', date: '2026-11-23', time: '19:09:32-05:00', cude: 'd'.repeat(96) },
    ],
    ResponseDian: { Envelope: { ...body.ResponseDian.Envelope, Body: { GetStatusEventResponse: { GetStatusEventResult: {
      ErrorMessage: { string: [
        'Regla: RUT01, Notificación: La validación del estado del RUT próximamente estará disponible.',
        'Regla: RUT01, Notificación: La validación del estado del RUT próximamente estará disponible.',
      ] },
      IsValid: 'true', StatusCode: '00', StatusDescription: 'Procesado Correctamente.',
      StatusMessage: 'La Factura electrónica FV-453, ha sido autorizada.',
      XmlBase64Bytes: 'PD94bWwgdmVyc2lvbjG9uc2U+',
      XmlBytes: { _attributes: { nil: 'true' } }, XmlDocumentKey: cufe, XmlFileName: 'fv-test',
    } } } } },
  };
}

it('lee la respuesta real con dian_code 030, 032 y 034 sin confundir la notificación RUT con un rechazo', () => {
  expect(parseInvoiceRadianStatus(realEventsResponse())).toEqual({ accepted: true, eventCodes: ['030', '032', '034'] });
});

it.each(['033', '034'])('devuelve allowed false y el mensaje de aceptación para dian_code %s', async code => {
  const { client, http } = setupClient();
  const body = realEventsResponse();
  body.events[2].dian_code = code;
  http.post.mockReturnValue(of({ status: 200, data: body } as never));
  const service = new JarvisRadianService(
    { findById: jest.fn().mockResolvedValue({ nextPymeToken: 'owner-token' }) } as never,
    { findByCompanyAndProvider: jest.fn().mockResolvedValue({ subscriptionStatus: 'ACTIVE' }) } as never,
    client, {} as never,
  );
  await expect(service.noteEligibility('owner', cufe)).resolves.toEqual({ source: 'nextpyme', allowed: false, blockReason: expect.stringContaining('aceptación en RADIAN') });
});

it('permite una factura con solo acuse y recibo usando los eventos estructurados aunque el XML de factura esté abreviado', async () => {
  const { client, http } = setupClient();
  const body = realEventsResponse();
  body.events = body.events.slice(0, 2);
  body.events[0].event_number = '4';
  http.post.mockReturnValue(of({ status: 200, data: body } as never));
  await expect(client.getInvoiceRadianStatus(cufe, 'token')).resolves.toEqual({ accepted: false, eventCodes: ['030', '032'] });
});

it('no confunde el consecutivo del evento con su código DIAN ni toma una lista desconocida como ausencia de aceptación', () => {
  expect(parseInvoiceRadianStatus({ success: true, events: [{ event_number: '4' }] })).toBeNull();
  const body = realEventsResponse();
  body.events = [{ ...body.events[0], dian_code: '999' }];
  expect(parseInvoiceRadianStatus(body)).toBeNull();
});

it.each(['99', '66'])('no convierte el código DIAN de error %s en permiso aunque haya una lista estructurada', code => {
  const body = realEventsResponse();
  body.events = body.events.slice(0, 2);
  body.ResponseDian.Envelope.Body.GetStatusEventResponse.GetStatusEventResult.StatusCode = code;
  expect(parseInvoiceRadianStatus(body)).toBeNull();
});
