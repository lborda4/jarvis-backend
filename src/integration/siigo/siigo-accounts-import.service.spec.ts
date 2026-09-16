import { SiigoAccountsImportService } from './siigo-accounts-import.service';

jest.mock('./helpers/accounts-excel.helper', () => ({
  parseAccountsExcel: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseAccountsExcel } = require('./helpers/accounts-excel.helper');

function buildFile(): Express.Multer.File {
  return { buffer: Buffer.from('fake-excel'), originalname: 'cuentas.xlsx' } as any;
}

function buildService(overrides: {
  findByCompanyAndProvider?: jest.Mock;
  findByCompanyAndIntegration?: jest.Mock;
}) {
  const dataSource = {
    transaction: jest.fn().mockImplementation(async (fn: any) => fn({ save: jest.fn() })),
  };
  const integrationsRepository = {
    findByCompanyAndProvider:
      overrides.findByCompanyAndProvider ??
      jest.fn().mockResolvedValue({ id: 'integration-1', accountsExcelImportedAt: null }),
    save: jest.fn().mockImplementation((entity) => entity),
  };
  const siigoAccountsRepository = {
    findByCompanyAndIntegration:
      overrides.findByCompanyAndIntegration ?? jest.fn().mockResolvedValue([]),
    create: jest.fn().mockImplementation((entity) => entity),
  };
  const siigoConfigurationCacheService = {
    invalidateCompanyCache: jest.fn(),
  };

  const service = new SiigoAccountsImportService(
    dataSource as any,
    integrationsRepository as any,
    siigoAccountsRepository as any,
    siigoConfigurationCacheService as any,
  );

  return { service, integrationsRepository };
}

describe('SiigoAccountsImportService.importFromExcel — accountsExcelImportedAt', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('marca accountsExcelImportedAt cuando el Excel trae al menos una cuenta válida (caso real pedido: el paso "Cuentas contables" solo debe quedar completo con el Excel realmente cargado)', async () => {
    parseAccountsExcel.mockReturnValue({
      rows: [{ accountCode: '5135', accountName: 'Gastos diversos' }],
      skippedRows: 0,
    });
    const { service, integrationsRepository } = buildService({});

    await service.importFromExcel(buildFile(), 'company-1');

    expect(integrationsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ accountsExcelImportedAt: expect.any(Date) }),
    );
  });

  it('NO marca accountsExcelImportedAt si el Excel no trajo ninguna fila válida', async () => {
    parseAccountsExcel.mockReturnValue({ rows: [], skippedRows: 3 });
    const { service, integrationsRepository } = buildService({});

    await service.importFromExcel(buildFile(), 'company-1');

    expect(integrationsRepository.save).not.toHaveBeenCalled();
  });
});
