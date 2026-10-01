import { BadGatewayException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { Company } from '../company/entities/company.entity';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

function setup() {
  let company = {
    id: 'company-1', nit: '900123456', name: 'Empresa',
    createdAt: new Date(), nextPymeToken: 'old-token', integrations: [],
  };
  const companies = {
    findByNit: jest.fn().mockResolvedValue(null),
    findById: jest.fn(async () => company),
    create: jest.fn((value) => ({ ...company, ...value })),
    save: jest.fn(async (value) => { company = value; return company; }),
    findOne: jest.fn(async () => company),
  };
  const otherRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const dataSource = {
    transaction: jest.fn(async (callback) => callback({
      getRepository: (entity) => entity === Company ? companies : otherRepository,
    })),
  };
  const nextPyme = { configureProductionEnvironment: jest.fn().mockResolvedValue(undefined) };
  const service = new AdminService(
    dataSource as never, companies as never, {} as never, {} as never,
    { normalizeDocumentTypes: () => [] } as never,
    {} as never, {} as never, nextPyme as never,
  );
  const request = {
    nit: '900123456', name: 'Empresa', personType: CompanyPersonType.LEGAL_ENTITY,
    integrations: [IntegrationProvider.BOLD], nextPymeToken: ' company-token ',
  };
  return { service, companies, dataSource, nextPyme, request };
}

describe('Configuración NextPyme de empresa desde admin', () => {
  it('activa producción antes de confirmar la creación con token propio', async () => {
    const { service, nextPyme, companies, request } = setup();
    const result = await service.createCompany(request, 'admin-1');
    expect(nextPyme.configureProductionEnvironment).toHaveBeenCalledWith('company-token');
    expect(result.company.nextPymeToken).toBe('company-token');
    expect(result.company.billingCycle).toBe('MONTHLY');
    expect(result.company.subscriptionDueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(nextPyme.configureProductionEnvironment.mock.invocationCallOrder[0])
      .toBeLessThan(companies.save.mock.invocationCallOrder[0]);
  });

  it.each([undefined, '', ' '])('crea sin llamar a NextPyme cuando no hay token (%s)', async (token) => {
    const { service, nextPyme, request } = setup();
    const result = await service.createCompany({ ...request, nextPymeToken: token }, 'admin-1');
    expect(nextPyme.configureProductionEnvironment).not.toHaveBeenCalled();
    expect(result.company.nextPymeToken).toBeNull();
  });

  it('no crea una empresa a medias si NextPyme falla; permite reintentar', async () => {
    const { service, nextPyme, dataSource, request } = setup();
    nextPyme.configureProductionEnvironment.mockRejectedValueOnce(new BadGatewayException());
    await expect(service.createCompany(request, 'admin-1')).rejects.toThrow(BadGatewayException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    await expect(service.createCompany(request, 'admin-1')).resolves.toBeDefined();
  });

  it.each(['new-token', 'old-token'])('activa producción incluso si se guarda el mismo token (%s)', async (token) => {
    const { service, nextPyme } = setup();
    const result = await service.updateNextPymeToken('company-1', { nextPymeToken: ` ${token} ` }, 'admin-1');
    expect(nextPyme.configureProductionEnvironment).toHaveBeenCalledWith(token);
    expect(result.company.nextPymeToken).toBe(token);
  });

  it('conserva el token anterior si falla el cambio de ambiente', async () => {
    const { service, nextPyme, companies } = setup();
    nextPyme.configureProductionEnvironment.mockRejectedValue(new BadGatewayException());
    await expect(service.updateNextPymeToken('company-1', { nextPymeToken: 'new-token' }, 'admin-1'))
      .rejects.toThrow(BadGatewayException);
    expect(companies.save).not.toHaveBeenCalled();
    expect((await companies.findById()).nextPymeToken).toBe('old-token');
  });

  it('eliminar el token no cambia el ambiente de ninguna empresa', async () => {
    const { service, nextPyme } = setup();
    const result = await service.updateNextPymeToken('company-1', { nextPymeToken: null }, 'admin-1');
    expect(nextPyme.configureProductionEnvironment).not.toHaveBeenCalled();
    expect(result.company.nextPymeToken).toBeNull();
  });

  it('no llama a NextPyme si el NIT ya existe', async () => {
    const { service, nextPyme, companies, request } = setup();
    companies.findByNit.mockResolvedValue({ id: 'existing' });
    await expect(service.createCompany(request, 'admin-1')).rejects.toThrow('Ya existe');
    expect(nextPyme.configureProductionEnvironment).not.toHaveBeenCalled();
  });
});
