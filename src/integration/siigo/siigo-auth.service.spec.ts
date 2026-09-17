import { SiigoAuthService } from './siigo-auth.service';
import { IntegrationProvider } from '../enums/integration-provider.enum';

function buildIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: 'integration-1',
    companyId: 'company-1',
    provider: IntegrationProvider.SIIGO,
    credentials: {
      username: 'user@empresa.com',
      access_key: 'clave-123',
    },
    accountsExcelImportedAt: null,
    ...overrides,
  };
}

function buildService(overrides: {
  integration?: ReturnType<typeof buildIntegration> | null;
  accountsCount?: number;
}) {
  const integrationsRepository = {
    findByCompanyAndProvider: jest
      .fn()
      .mockResolvedValue(
        overrides.integration === undefined
          ? buildIntegration()
          : overrides.integration,
      ),
  };
  const siigoAccountsRepository = {
    countByCompanyAndIntegration: jest
      .fn()
      .mockResolvedValue(overrides.accountsCount ?? 0),
  };
  const planSubscriptionService = {
    getSubscription: jest.fn().mockResolvedValue({
      includedDocumentTypes: [],
    }),
  };

  const service = new SiigoAuthService(
    {} as any, // siigoHttpClient
    integrationsRepository as any,
    siigoAccountsRepository as any,
    planSubscriptionService as any,
    {} as any, // configService
  );

  return { service };
}

describe('SiigoAuthService.getCredentialsStatus — hasAccounts', () => {
  it('false cuando hay cuentas (del sync automático) pero nunca se importó el Excel — caso real reportado: el paso quedaba "listo" sin haber subido nunca el plan de cuentas', async () => {
    const { service } = buildService({
      integration: buildIntegration({ accountsExcelImportedAt: null }),
      accountsCount: 5,
    });

    const status = await service.getCredentialsStatus('company-1');

    expect(status.hasAccounts).toBe(false);
  });

  it('false cuando se importó el Excel pero por alguna razón no quedó ninguna cuenta guardada', async () => {
    const { service } = buildService({
      integration: buildIntegration({
        accountsExcelImportedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      accountsCount: 0,
    });

    const status = await service.getCredentialsStatus('company-1');

    expect(status.hasAccounts).toBe(false);
  });

  it('true solo cuando el Excel se importó Y hay cuentas guardadas', async () => {
    const { service } = buildService({
      integration: buildIntegration({
        accountsExcelImportedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      accountsCount: 120,
    });

    const status = await service.getCredentialsStatus('company-1');

    expect(status.hasAccounts).toBe(true);
  });
});
