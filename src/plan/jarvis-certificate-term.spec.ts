import { of, throwError } from 'rxjs';
import { NextPymeApiClient } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { parseJarvisCertificateTerm } from './jarvis-certificate-term';

const response = (expiration_date = '2023-12-06 14:59:06') => ({ success: true, certificates: [{ name: 'example.p12', password: 'ignored-p12-secret', expiration_date }] });

it('deriva un año calendario antes del vencimiento en Colombia y no retiene datos del certificado', () => {
  const result = parseJarvisCertificateTerm(response(), new Date('2026-11-19T12:00:00Z'));
  expect(result).toEqual({ startsAt: '2022-12-06T19:59:06.000Z', endsAt: '2023-12-06T19:59:06.000Z', checkedAt: '2026-11-19T12:00:00.000Z' });
  expect(JSON.stringify(result)).not.toContain('ignored-p12-secret');
  expect(JSON.stringify(result)).not.toContain('example.p12');
});

it('ajusta el 29 de febrero al 28 al restar un año y elige el certificado con vencimiento más reciente', () => {
  const payload = response('2028-02-29 23:30:00');
  payload.certificates.unshift(response().certificates[0]);
  const result = parseJarvisCertificateTerm(payload);
  expect(result.startsAt).toBe('2027-03-01T04:30:00.000Z');
  expect(result.endsAt).toBe('2028-03-01T04:30:00.000Z');
});

it.each([null, { success: false, certificates: [] }, { success: true, certificates: [] }, response('2026-02-30 10:00:00'), response('2026-12-01 25:00:00'), response('invalid')])('rechaza respuestas sin un vencimiento válido: %j', payload => {
  expect(() => parseJarvisCertificateTerm(payload)).toThrow('vencimiento válida');
});

it('usa POST con cuerpo vacío al NIT consultado y devuelve solo las fechas', async () => {
  const http = { post: jest.fn().mockReturnValue(of({ status: 200, data: response() })) };
  const config = { get: jest.fn((key: string) => key === 'nextPyme.baseUrl' ? 'https://example.test/api/ubl2.1' : undefined) };
  const client = new NextPymeApiClient(http as never, config as never);
  expect((await client.getCertificateTerm('902086460-1', 'company-token')).endsAt).toBe('2023-12-06T19:59:06.000Z');
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.post).toHaveBeenCalledWith('https://example.test/api/ubl2.1/certificates-listing/902086460', '', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer company-token', Accept: 'application/json', 'Content-Type': 'application/json' }) }));
  http.post.mockReturnValueOnce(throwError(() => new Error('private remote body and token')));
  await expect(client.getCertificateTerm('902086460', 'company-token')).rejects.toThrow('No se pudo consultar');
  http.post.mockReturnValueOnce(of({ status: 401, data: response() }));
  await expect(client.getCertificateTerm('902086460', 'company-token')).rejects.toThrow('No se pudo consultar');
});
