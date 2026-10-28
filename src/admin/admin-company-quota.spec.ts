import { BadGatewayException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { Integration } from '../integration/entities/integration.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

function setup(documentLimit: number | null = 20) {
  const plan = { id: 'jarvis-plan', provider: IntegrationProvider.JARVIS, documentLimit };
  const company = { id: 'company-1', nit: '900123456-7', name: 'Empresa', createdAt: new Date(), integrations: [] };
  const companies = {
    findByNit: jest.fn(async (nit: string) => nit === '902086460' ? { nextPymeToken: ' jarvis-token ' } : null),
    create: jest.fn((value) => ({ ...company, ...value })),
    save: jest.fn(async (value) => value),
    findOne: jest.fn(async () => company),
  };
  const integrations = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => { company.integrations = [value] as never; return value; }),
  };
  const links = { findOne: jest.fn().mockResolvedValue({}), create: jest.fn(), save: jest.fn() };
  const dataSource = { transaction: jest.fn(async (callback) => callback({
    getRepository: (entity) => entity === Company ? companies : entity === Integration ? integrations : links,
  })) };
  const nextPyme = { assignDocumentPackage: jest.fn().mockResolvedValue({ success: true }) };
  const service = new AdminService(dataSource as never, companies as never,
    { findById: jest.fn().mockResolvedValue(plan) } as never, {} as never,
    { normalizeDocumentTypes: () => [], resolveIncludedDocumentTypes: () => [] } as never, {} as never, {} as never, nextPyme as never);
  const request = { nit: company.nit, name: company.name, personType: CompanyPersonType.LEGAL_ENTITY,
    integrations: [IntegrationProvider.JARVIS], jarvisPlanId: plan.id };
  return { service, request, nextPyme, companies, plan };
}

describe('Cupo inicial Jarvis y reserva NextPyme', () => {
  it.each([20, 100])('habilita el cupo de %s más uno sin aumentar el límite de Jarvis', async (limit) => {
    const { service, request, nextPyme, plan } = setup(limit);
    const result = await service.createCompany(request, 'admin');
    expect(nextPyme.assignDocumentPackage).toHaveBeenCalledTimes(1);
    expect(nextPyme.assignDocumentPackage).toHaveBeenCalledWith({
      user_identification_number: 900123456,
      absolut_start_plan_date: expect.any(String), absolut_documents: limit + 1,
    }, 'jarvis-token');
    expect(result.company.integrations[0].plan?.documentLimit).toBe(limit);
    expect(plan.documentLimit).toBe(limit);
  });

  it('no asigna una cantidad finita a planes ilimitados', async () => {
    const { service, request, nextPyme } = setup(null);
    await service.createCompany(request, 'admin');
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('no asigna paquetes para empresas sin Jarvis', async () => {
    const { service, request, nextPyme } = setup();
    await service.createCompany({ ...request, integrations: [IntegrationProvider.BOLD] }, 'admin');
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('propaga el error dentro de la transacción de alta para permitir su reversión', async () => {
    const { service, request, nextPyme, companies } = setup();
    nextPyme.assignDocumentPackage.mockRejectedValueOnce(new BadGatewayException());
    await expect(service.createCompany(request, 'admin')).rejects.toThrow(BadGatewayException);
    expect(companies.findOne).not.toHaveBeenCalled();
    await expect(service.createCompany(request, 'admin')).resolves.toBeDefined();
  });

  it('rechaza el alta si falta el token de Jarvis para asignar documentos', async () => {
    const { service, request, nextPyme, companies } = setup();
    companies.findByNit.mockResolvedValue(null);
    await expect(service.createCompany(request, 'admin')).rejects.toThrow('JARVIS COLOMBIA');
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });
});
