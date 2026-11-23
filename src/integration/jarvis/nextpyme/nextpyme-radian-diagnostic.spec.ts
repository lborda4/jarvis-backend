import { radianProviderDiagnostic } from './nextpyme-radian-diagnostic';

it('conserva el error DIAN anidado y su código sin incluir el XML ni las credenciales', () => {
  const result = radianProviderDiagnostic({ ResponseDian: { Result: { StatusCode: '99', ErrorMessage: { string: ['Certificado vencido', 'token=secret-value'] }, XmlBase64Bytes: 'private-xml', password: 'private-password' } } }, 'secret-value');
  expect(result.providerMessages).toEqual(['Certificado vencido', 'token=[REDACTED]']);
  expect(result.providerStatusCodes).toEqual(['99']);
  expect(JSON.stringify(result)).not.toMatch(/secret-value|private-xml|private-password/);
});

it('no registra HTML, datos generales ni mensajes de transporte arbitrarios', () => {
  expect(radianProviderDiagnostic('<html>private</html>', 'secret').providerMessages).toEqual([]);
  expect(radianProviderDiagnostic({ customer: 'Private name', unknown: 'Private data', message: '<html>private</html>' }, 'secret').providerMessages).toEqual([]);
});

it('limita mensajes, tamaño y ciclos', () => {
  const payload: any = { errors: Array.from({ length: 50 }, (_, i) => `Error ${i}: ${'dato '.repeat(500)}`) };
  payload.loop = payload;
  const result = radianProviderDiagnostic(payload, 'secret');
  expect(result.providerMessages).toHaveLength(4);
  expect(result.providerMessages.every(message => message.length <= 500)).toBe(true);
});

it('lee JSON anidado y oculta bearer, correos y CUFE en los mensajes', () => {
  const result = radianProviderDiagnostic({ ResponseDian: JSON.stringify({ faultstring: `Falló Bearer another-secret para user@example.com ${'a'.repeat(96)}` }) }, 'secret-value');
  expect(result.providerMessages[0]).toContain('Falló');
  expect(JSON.stringify(result)).not.toMatch(/another-secret|user@example|a{96}/);
});
