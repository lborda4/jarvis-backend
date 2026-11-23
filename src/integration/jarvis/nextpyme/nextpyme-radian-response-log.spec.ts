import { radianResponseForLog } from './nextpyme-radian-response-log';

it('conserva tipos, longitud de eventos y código SOAP 67 sin eventos', () => {
  const body = { success: true, events: [], ResponseDian: { Envelope: { Body: { GetStatusEventResponse: { GetStatusEventResult: { StatusCode: { _value: '67' }, IsValid: false, DianResponse: {} } } } } } };
  const result: any = radianResponseForLog(body, 'private-token');
  expect(result.success).toBe(true);
  expect(result.events).toEqual({ arrayLength: 0, items: [] });
  expect(result.responsedian.envelope.body.getstatuseventresponse.getstatuseventresult).toEqual({ statuscode: { value: '67' }, isvalid: false, dianresponse: {} });
});

it('excluye nombres, datos personales y valores de campos desconocidos', () => {
  const body = { success: true, events: [], token: 'private-token', cufecude: 'a'.repeat(96), certificate_days_left: 239, 'private-name': 'private-data', ResponseDian: { Envelope: { Header: { Security: 'private-cert' }, Body: { StatusCode: '67', message: 'Persona privada con NIT 123456789', XmlBase64Bytes: 'private-xml', customer: { email: 'user@example.com' }, status: 'private-status', code: 'private-code' } } } };
  const log = JSON.stringify(radianResponseForLog(body, 'private-token'));
  expect(log).toContain('67');
  expect(log).not.toMatch(/private|123456789|user@example.com|a{96}/);
});

it('redacta textos libres incluso en JSON serializado', () => {
  const result: any = radianResponseForLog({ ResponseDian: JSON.stringify({ StatusCode: '67', token: 'other-token', message: 'private-data' }) }, 'private-token');
  expect(JSON.parse(result.responsedian).statuscode).toBe('67');
  expect(JSON.stringify(result)).not.toMatch(/other-token|private-data/);
});

it('limita ciclos y respuestas grandes y preserva la cantidad original de eventos', () => {
  const body: any = { events: Array.from({ length: 200 }, () => ({ message: 'private-data' })) };
  body.result = body;
  const result: any = radianResponseForLog(body, 'private-token');
  expect(result.result).toBe('[CIRCULAR]');
  expect(result.events.arrayLength).toBe(200);
  expect(result.events.items).toHaveLength(10);
});

it('solo imprime valores booleanos y códigos numéricos acotados con sus tipos originales', () => {
  expect(radianResponseForLog({ success: ' true ', IsValid: 0, StatusCode: ' 67 ', message: 'EL CUFE o Factura consultada no tiene a la fecha eventos asociados.' }, '')).toEqual({ success: ' true ', isvalid: 0, statuscode: ' 67 ', message: 'EL CUFE o Factura consultada no tiene a la fecha eventos asociados.' });
  expect(JSON.stringify(radianResponseForLog({ success: 'private-data', StatusCode: 123456789 }, ''))).not.toMatch(/private-data|123456789/);
});
