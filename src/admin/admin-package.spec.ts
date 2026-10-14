import { AdminService } from './admin.service';
import { NextPymeApiClient } from '../integration/jarvis/nextpyme/nextpyme-api.client';
import { of } from 'rxjs';

beforeEach(() => { jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-13T20:00:00-05:00')); });
afterEach(() => { jest.restoreAllMocks(); });

function setup() {
  const client = { assignDocumentPackage: jest.fn().mockResolvedValue({ success: true }), getAssignedPackage: jest.fn().mockResolvedValue({ remaining_documents: 12 }) };
  const companies = { findByNit: jest.fn().mockResolvedValue({ nextPymeToken: ' jarvis-token ' }), findById: jest.fn().mockResolvedValue({ nit: '901249232-1', nextPymeToken: ' company-token ' }) };
  const service = new AdminService({} as never, companies as never, {} as never, {} as never, {} as never, {} as never, {} as never, client as never);
  return { service, companies, client };
}
it('asigna el NIT de la empresa y el payload exacto usando siempre el token de Jarvis', async () => {
  const { service, client } = setup();
  await service.assignNextPymePackage('company', { documents: 100 });
  expect(client.assignDocumentPackage).toHaveBeenCalledWith({ user_identification_number: 901249232, absolut_start_plan_date: '2026-01-13 20:00:00', absolut_documents: 100 }, 'jarvis-token');
});
it.each([0, -1, 1.5, NaN])('no envía cantidades inválidas %s', async documents => {
  const { service, client } = setup();
  await expect(service.assignNextPymePackage('company', { documents })).rejects.toThrow();
  expect(client.assignDocumentPackage).not.toHaveBeenCalled();
});
it('consulta el saldo con el token correcto', async () => {
  const { service, client } = setup();
  expect(await service.getNextPymePackage('company')).toEqual({ data: { remaining_documents: 12 } });
  expect(client.getAssignedPackage).toHaveBeenCalledWith('company-token');
});
it('no opera sobre empresas inexistentes', async () => {
  const { service, companies, client } = setup(); companies.findById.mockResolvedValue(null as never);
  await expect(service.getNextPymePackage('missing')).rejects.toThrow();
  expect(client.getAssignedPackage).not.toHaveBeenCalled();
});
it('envía PUT y GET al endpoint de paquetes y rechaza errores del servicio', async () => {
  const http = { put: jest.fn().mockReturnValue(of({ status: 200, data: { success: true } })), get: jest.fn().mockReturnValue(of({ status: 200, data: { remaining_documents: 5 } })) };
  const config = { get: jest.fn((key: string) => key === 'nextPyme.baseUrl' ? 'https://example.test/ubl2.1' : undefined) };
  const client = new NextPymeApiClient(http as never, config as never);
  const body = { user_identification_number: 901249232, absolut_start_plan_date: '2026-01-13 11:57:00', absolut_documents: 1 };
  await client.assignDocumentPackage(body, 'token'); await client.getAssignedPackage('token');
  expect(http.put).toHaveBeenCalledWith('https://example.test/ubl2.1/plan/assign-package-user', body, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
  expect(http.get).toHaveBeenCalledWith('https://example.test/ubl2.1/plan/infoplanuser', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
  http.put.mockReturnValue(of({ status: 200, data: { success: false } }));
  await expect(client.assignDocumentPackage(body, 'token')).rejects.toThrow('No se pudo completar');
  http.put.mockReturnValue(of({ status: 422, data: { message: 'La fecha de inicio debe ser posterior o igual a hoy.' } }));
  await expect(client.assignDocumentPackage(body, 'token')).rejects.toThrow('HTTP 422');
  await expect(client.assignDocumentPackage(body, 'token')).rejects.toThrow('La fecha de inicio debe ser posterior o igual a hoy.');
});

it('no consulta con el token global si la empresa no tiene token propio', async () => {
  const { service, companies, client } = setup();
  companies.findById.mockResolvedValue({ nit: '901249232', nextPymeToken: ' ' });
  await expect(service.getNextPymePackage('company')).rejects.toThrow('token de NextPyme');
  expect(client.getAssignedPackage).not.toHaveBeenCalled();
});

it('no recarga con otro token cuando falta el token de Jarvis', async () => {
  const { service, companies, client } = setup();
  companies.findByNit.mockResolvedValue({ nextPymeToken: ' ' });
  await expect(service.assignNextPymePackage('company', { documents: 1 })).rejects.toThrow('JARVIS COLOMBIA');
  expect(client.assignDocumentPackage).not.toHaveBeenCalled();
});
