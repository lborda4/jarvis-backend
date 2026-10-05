import { SiigoCreditNoteNumberingService } from './siigo-credit-note-numbering.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';

describe('SiigoCreditNoteNumberingService', () => {
  function buildService(existing?: Record<string, unknown>) {
    const integration = {
      credentials: {
        username: 'user',
        access_key: 'key',
        ...(existing ?? {}),
      },
    };
    const integrationsRepository = {
      findByCompanyAndProvider: jest.fn().mockResolvedValue(integration),
      save: jest.fn(async (value) => value),
    };
    const service = new SiigoCreditNoteNumberingService(
      integrationsRepository as never,
    );
    return { service, integrationsRepository, integration };
  }

  it('asegura NC desde 1 la primera vez y avanza al confirmar', async () => {
    const { service, integrationsRepository } = buildService();

    await expect(service.allocateNumber('company-1')).resolves.toEqual({
      prefix: 'NC',
      number: 1,
      formNumber: null,
    });
    expect(integrationsRepository.save).toHaveBeenCalled();

    await service.commitNumber('company-1', 1);
    const saved = integrationsRepository.save.mock.calls.at(-1)![0];
    expect(saved.credentials.credit_note.nextConsecutive).toBe(2);
    expect(
      integrationsRepository.findByCompanyAndProvider,
    ).toHaveBeenCalledWith('company-1', IntegrationProvider.SIIGO);
  });

  it('reutiliza el contador persistido', async () => {
    const { service } = buildService({
      credit_note: {
        prefix: 'NC',
        fromNumber: 1,
        toNumber: 100,
        nextConsecutive: 7,
      },
    });

    await expect(service.allocateNumber('company-1')).resolves.toEqual({
      prefix: 'NC',
      number: 7,
      formNumber: null,
    });
  });
});
