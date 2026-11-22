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
    save: jest.fn(async (value) => Object.assign(company, value)),
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
  const nextPyme = {
    getCertificateTerm: jest.fn().mockResolvedValue({ startsAt: '2026-01-01T05:00:00.000Z', endsAt: '2027-01-01T05:00:00.000Z', checkedAt: '2026-11-19T12:00:00.000Z' }),
    configureProductionEnvironment: jest.fn().mockResolvedValue(undefined),
    assignDocumentPackage: jest.fn().mockResolvedValue({ success: true }),
  };
  const service = new AdminService(dataSource as never, companies as never,
    { findById: jest.fn().mockResolvedValue(plan) } as never, {} as never,
    { normalizeDocumentTypes: () => [], resolveIncludedDocumentTypes: () => [] } as never, {} as never, {} as never, nextPyme as never);
  const request = { registrationEmail: 'user@example.com', nextPymeToken: ' company-token ', nit: company.nit, name: company.name, personType: CompanyPersonType.LEGAL_ENTITY,
    integrations: [IntegrationProvider.JARVIS], jarvisPlanId: plan.id };
  return { service, request, nextPyme, companies, plan };
}

describe('Cupo inicial Jarvis y reserva NextPyme', () => {
  it('consulta una sola vez al asignar el plan inicial y guarda la vigencia en Jarvis', async () => {
    const { service, request, nextPyme } = setup(50);
    const result = await service.createCompany(request, 'admin');
    expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(1);
    expect(nextPyme.getCertificateTerm).toHaveBeenCalledWith('9001234567', 'company-token');
    expect(result.company.integrations[0].jarvisCertificateTerm).toMatchObject({ startsAt: '2026-01-01T05:00:00.000Z', endsAt: '2027-01-01T05:00:00.000Z' });
    expect(result.company.integrations[0].subscriptionStartedAt).toBe('2026-01-01T05:00:00.000Z');
  });

  it('no crea ni asigna documentos cuando no puede consultar el certificado', async () => {
    const { service, request, nextPyme, companies } = setup();
    nextPyme.getCertificateTerm.mockRejectedValueOnce(new BadGatewayException('Certificado no disponible'));
    await expect(service.createCompany(request, 'admin')).rejects.toThrow('Certificado no disponible');
    expect(companies.save).not.toHaveBeenCalled();
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });
  it('aplica la recarga inicial en ambos cupos y solo agrega la reserva una vez', async () => {
    const { service, request, plan, nextPyme } = setup(50);
    Object.assign(plan, { commercialTerms: { billingMonths: 12, modules: ['BILLING'], employeeLimit: null } });
    const result = await service.createCompany({ ...request, jarvisTopUpCodes: ['documents_100'] }, 'admin');
    expect(nextPyme.assignDocumentPackage).toHaveBeenCalledWith(expect.objectContaining({ absolut_documents: 151 }), 'jarvis-token');
    expect(result.company.integrations[0].topUpOperations).toEqual([expect.objectContaining({ status: 'APPLIED', topUps: [expect.objectContaining({ units: 100, priceCop: 149900 })] })]);
    expect(plan.documentLimit).toBe(50);
  });
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
    expect(result.nextPymePackage?.status).toBe('ASSIGNED');
  });

  it.each([undefined, '', ' '])('crea primero en Jarvis sin asignar documentos si no hay token propio (%s)', async (token) => {
    const { service, request, nextPyme, companies } = setup();
    const result = await service.createCompany({ ...request, nextPymeToken: token }, 'admin');
    expect(result.company.id).toBe('company-1');
    expect(result.company.nextPymeToken).toBeNull();
    expect(result.company.integrations[0].plan?.documentLimit).toBe(20);
    expect(result.nextPymePackage).toEqual({ status: 'PENDING', message: expect.stringContaining('recarga') });
    expect(companies.findByNit).toHaveBeenCalledTimes(2);
    expect(nextPyme.getCertificateTerm).toHaveBeenCalledTimes(1);
    expect(nextPyme.getCertificateTerm).toHaveBeenCalledWith('9001234567', 'jarvis-token');
    expect(nextPyme.configureProductionEnvironment).not.toHaveBeenCalled();
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('no asigna una cantidad finita a planes ilimitados', async () => {
    const { service, request, nextPyme } = setup(null);
    await service.createCompany(request, 'admin');
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('guarda recargas comerciales por separado con sus valores del catálogo', async () => {
    const { service, request, plan, nextPyme } = setup(50);
    Object.assign(plan, { commercialTerms: { priceCop: 230000, billingMonths: 12, employeeLimit: 2, modules: ['BILLING', 'PAYROLL'] } });
    const result = await service.createCompany({ ...request, nextPymeToken: undefined, jarvisTopUpCodes: ['documents_100', 'payroll_5'] }, 'admin');
    expect(result.company.integrations[0].commercialTopUps).toEqual([
      expect.objectContaining({ code: 'documents_100', priceCop: 149900 }), expect.objectContaining({ code: 'payroll_5', priceCop: 88000 }),
    ]);
    expect(result.company.integrations[0].plan?.commercialTerms?.priceCop).toBe(230000);
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('no crea la empresa si la recarga es ajena al plan', async () => {
    const { service, request, plan, companies, nextPyme } = setup(null);
    Object.assign(plan, { commercialTerms: { modules: ['PAYROLL'], employeeLimit: 2, billingMonths: 12 } });
    await expect(service.createCompany({ ...request, jarvisTopUpCodes: ['documents_10'] }, 'admin')).rejects.toThrow('no corresponde');
    expect(companies.save).not.toHaveBeenCalled();
    expect(nextPyme.configureProductionEnvironment).not.toHaveBeenCalled();
  });

  it('vincula el plan comercial con su precio, módulos y período anual guardados en el servidor', async () => {
    const { service, request, plan, companies, nextPyme } = setup(50);
    const commercialTerms = { priceCop: 230000, billingMonths: 12, employeeLimit: 2, modules: ['BILLING', 'PAYROLL'], includesDigitalCertificate: true, includesRadian: true };
    Object.assign(plan, { code: 'jarvis_compliance_initial_annual', commercialTerms });
    const result = await service.createCompany({ ...request, nextPymeToken: undefined, billingMonths: 1, jarvisModules: ['PAYROLL'] }, 'admin');
    expect(result.company.integrations[0].plan).toMatchObject({ id: plan.id, documentLimit: 50, commercialTerms });
    expect(companies.save).toHaveBeenCalledWith(expect.objectContaining({ billingMonths: 12, billingCycle: 'ANNUAL', jarvisModules: ['BILLING', 'PAYROLL'] }));
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('mantiene la nómina individual separada de los planes de facturación y de las recargas', async () => {
    const { service, request, plan, nextPyme } = setup(null);
    Object.assign(plan, { commercialTerms: { priceCop: 129900, billingMonths: 12, employeeLimit: 2, modules: ['PAYROLL'], includesDigitalCertificate: true, includesRadian: false } });
    const result = await service.createCompany({ ...request, nextPymeToken: undefined }, 'admin');
    expect(result.company.jarvisModules).toEqual(['PAYROLL']);
    expect(result.company.billingMonths).toBe(12);
    expect(result.company.integrations[0].plan?.commercialTerms?.priceCop).toBe(129900);
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
  });

  it('no asigna paquetes para empresas sin Jarvis', async () => {
    const { service, request, nextPyme } = setup();
    await service.createCompany({ ...request, integrations: [IntegrationProvider.BOLD] }, 'admin');
    expect(nextPyme.assignDocumentPackage).not.toHaveBeenCalled();
    expect(nextPyme.getCertificateTerm).not.toHaveBeenCalled();
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


it('suma 100 y 50 documentos al cupo base y asigna NextPyme una sola vez', async () => {
  const { service, request, plan, nextPyme } = setup(50);
  Object.assign(plan, { commercialTerms: { billingMonths: 12, modules: ['BILLING'], employeeLimit: null } });
  const result = await service.createCompany({ ...request, jarvisTopUpCodes: ['documents_100', 'documents_50'] }, 'admin');
  expect(nextPyme.assignDocumentPackage).toHaveBeenCalledTimes(1);
  expect(nextPyme.assignDocumentPackage).toHaveBeenCalledWith(expect.objectContaining({ absolut_documents: 201 }), 'jarvis-token');
  expect(result.company.integrations[0].topUpOperations[0].topUps.map(item => item.units)).toEqual([100, 50]);
  expect(plan.documentLimit).toBe(50);
});
