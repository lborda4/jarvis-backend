import { AdminService } from './admin.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import { Company } from '../company/entities/company.entity';
import { validateJarvisModules } from '../company/jarvis-modules';
import { mapCompanyToAuthCompanyDto } from '../auth/mappers/auth-response.mapper';

describe('Módulos de empresa Jarvis', () => {
  it.each([[], ['OTHER'], ['BILLING', 'OTHER'], null, 'PAYROLL'])('rechaza selección inválida: %j', value => {
    expect(() => validateJarvisModules(value)).toThrow('Selecciona Facturación');
  });
  it.each([['BILLING'], ['PAYROLL'], ['BILLING', 'PAYROLL']])('acepta módulos: %j', (...modules) => {
    expect(validateJarvisModules(modules)).toEqual(modules);
  });
  const company = () => ({ id: 'company', nit: '123', name: 'Empresa', createdAt: new Date(), jarvisModules: null,
    integrations: [{ id: 'jarvis', provider: IntegrationProvider.JARVIS, active: true }] });
  function setup(value = company()) {
    const repository = { findAllWithIntegrations: jest.fn().mockResolvedValue([value]), save: jest.fn(async item => item) };
    const service = new AdminService({} as never, repository as never, {} as never, {} as never, { resolveIncludedDocumentTypes: () => [] } as never, {} as never, {} as never, {} as never);
    return { service, repository, value };
  }
  it('conserva ambos módulos para empresas existentes y los incluye en autenticación', async () => {
    const { service, value } = setup();
    expect((await service.listCompanies()).items[0].jarvisModules).toEqual(['BILLING', 'PAYROLL']);
    expect(mapCompanyToAuthCompanyDto(value as unknown as Company).jarvisModules).toEqual(['BILLING', 'PAYROLL']);
  });
  it('edita los módulos sin cambiar la integración y los devuelve en autenticación', async () => {
    const { service, repository, value } = setup();
    const response = await service.updateJarvisModules('company', ['PAYROLL']);
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ jarvisModules: ['PAYROLL'], integrations: value.integrations }));
    expect(response.company.jarvisModules).toEqual(['PAYROLL']);
    expect(mapCompanyToAuthCompanyDto(value as unknown as Company).jarvisModules).toEqual(['PAYROLL']);
  });
  it('valida antes de guardar y exige una empresa con Jarvis', async () => {
    const { service, repository } = setup({ ...company(), integrations: [] });
    await expect(service.updateJarvisModules('company', ['PAYROLL'])).rejects.toThrow('no tiene integración Jarvis');
    await expect(service.updateJarvisModules('missing', ['PAYROLL'])).rejects.toThrow('Empresa no encontrada');
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('rechaza crear una empresa Jarvis sin módulos', async () => {
    const { service } = setup();
    await expect(service.createCompany({ nit: '900123456', name: 'Empresa', personType: CompanyPersonType.LEGAL_ENTITY,
      integrations: [IntegrationProvider.JARVIS], jarvisModules: [] }, 'admin')).rejects.toThrow('Selecciona Facturación');
  });
});
