import { AdminService } from './admin.service';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';

function setup() {
  const company = {
    id: 'company-1',
    nit: '900123456',
    name: 'Empresa',
    createdAt: new Date(),
    inviteCode: 'ABC123',
    nextPymeToken: null,
    integrations: [
      {
        id: 'int-1',
        provider: IntegrationProvider.JARVIS,
        active: true,
        credentials: { business_name: 'Empresa' },
        subscriptionStatus: null,
        subscriptionStartedAt: null,
        includedDocumentTypes: [],
        documentLimits: null,
        plan: null,
      },
    ],
  };
  const jarvis = {
    id: 'int-1',
    provider: IntegrationProvider.JARVIS,
    credentials: { business_name: 'Empresa' } as Record<string, unknown>,
  };
  const companies = {
    findById: jest.fn().mockResolvedValue(company),
    findAllWithIntegrations: jest.fn().mockImplementation(async () => [
      {
        ...company,
        integrations: [
          {
            ...company.integrations[0],
            credentials: jarvis.credentials,
          },
        ],
      },
    ]),
  };
  const integrations = {
    findByCompanyAndProvider: jest.fn(async (_id: string, provider: IntegrationProvider) =>
      provider === IntegrationProvider.JARVIS ? jarvis : null,
    ),
    save: jest.fn(async (value) => value),
  };
  const service = new AdminService(
    {} as never,
    companies as never,
    {} as never,
    integrations as never,
    { resolveIncludedDocumentTypes: () => [] } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { service, integrations, jarvis };
}

describe('AdminService.updateTechnicalKey', () => {
  it('persiste technical_key en integrations.credentials', async () => {
    const { service, integrations, jarvis } = setup();

    const result = await service.updateTechnicalKey(
      'company-1',
      { technicalKey: ' fc8eac422eba16e22ffd8c6f94b3f40a6e38162c ' },
      'admin-1',
    );

    expect(integrations.save).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          business_name: 'Empresa',
          technical_key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
        }),
      }),
    );
    expect(jarvis.credentials.technical_key).toBe(
      'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    );
    expect(result.company.technicalKey).toBe(
      'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
    );
  });

  it('elimina technical_key cuando llega vacío', async () => {
    const { service, jarvis } = setup();
    jarvis.credentials.technical_key = 'previa';

    const result = await service.updateTechnicalKey(
      'company-1',
      { technicalKey: '  ' },
      'admin-1',
    );

    expect(jarvis.credentials.technical_key).toBeUndefined();
    expect(result.company.technicalKey).toBeNull();
  });
});
