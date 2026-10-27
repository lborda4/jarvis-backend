import { ElectronicDocumentService } from './electronic-document.service';
import { ElectronicDocumentsRepository } from './repositories/electronic-documents.repository';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { parseDocumentProvider } from '../integration/helpers/document-provider.helper';

const { SIIGO, JARVIS } = IntegrationProvider;

function serviceForBothIntegrations() {
  const service = Object.create(ElectronicDocumentService.prototype) as ElectronicDocumentService;
  Object.assign(service, {
    integrationsRepository: {
      findByCompanyAndProvider: jest.fn(async (_companyId, provider) => ({ provider, active: true })),
    },
  });
  return service;
}

describe('aislamiento de integración de documentos', () => {
  it.each([SIIGO, JARVIS])('respeta la pantalla %s cuando ambas integraciones están activas', async (provider) => {
    await expect(serviceForBothIntegrations().resolveDocumentProvider('company', provider)).resolves.toBe(provider);
  });

  it('no elige Jarvis implícitamente cuando ambas integraciones están activas', async () => {
    await expect(serviceForBothIntegrations().resolveDocumentProvider('company')).rejects.toThrow(/provider/);
  });

  it('rechaza integraciones desconocidas', () => {
    expect(() => parseDocumentProvider('OTRA')).toThrow();
  });

  it('rechaza un destino no activo en la empresa', async () => {
    const service = serviceForBothIntegrations();
    Object.assign(service, { integrationsRepository: {
      findByCompanyAndProvider: jest.fn(async (_company, provider) => ({ provider, active: provider === JARVIS })),
    } });
    await expect(service.resolveDocumentProvider('company', SIIGO)).rejects.toThrow(/no está activa/);
  });

  it('guardar un payload antiguo no borra la integración asignada por otro proceso', async () => {
    const current = { id: 'doc', companyId: 'company', provider: SIIGO, status: 'ACCOUNT_REQUIRED', supplierExistsInSiigo: true };
    const save = jest.fn(async (document) => document);
    const documents = { findOne: jest.fn().mockResolvedValue(current), save };
    const repository = new ElectronicDocumentsRepository({ manager: {
      transaction: (callback) => callback({ getRepository: () => documents }),
    } } as never);
    await repository.save({ ...current, provider: null, status: 'PENDING', supplierExistsInSiigo: false, payload: {} } as never);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ provider: SIIGO, status: 'ACCOUNT_REQUIRED', supplierExistsInSiigo: true }));
  });

  it.each([[SIIGO, JARVIS], [JARVIS, SIIGO]])('impide que %s procese documentos de %s', async (requested, stored) => {
    const service = serviceForBothIntegrations();
    Object.assign(service, { electronicDocumentsRepository: {
      findById: jest.fn().mockResolvedValue({ id: 'doc', companyId: 'company', provider: stored }),
    } });
    await expect(service.requireById('doc', 'company', requested)).rejects.toThrow(/pertenece/);
  });

  it('vuelve a leer la asignación histórica para detectar una selección concurrente de otra integración', async () => {
    const service = serviceForBothIntegrations();
    const repository = {
      assignProviderIfUnset: jest.fn(),
      findById: jest.fn()
        .mockResolvedValueOnce({ id: 'doc', companyId: 'company', provider: null })
        .mockResolvedValueOnce({ id: 'doc', companyId: 'company', provider: JARVIS }),
    };
    Object.assign(service, { electronicDocumentsRepository: repository });
    await expect(service.requireById('doc', 'company', SIIGO)).rejects.toThrow(/pertenece/);
    expect(repository.assignProviderIfUnset).toHaveBeenCalledWith('doc', 'company', SIIGO);
  });

  it('la deduplicación de CUFE incluye la integración elegida', async () => {
    const find = jest.fn().mockResolvedValue([]);
    const repository = new ElectronicDocumentsRepository({ find } as never);
    await repository.findByCompanyAndCufes('company', ['same-cufe'], SIIGO);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 'company', provider: SIIGO }) }));
  });
});
