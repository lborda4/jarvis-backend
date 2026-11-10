import { NextPymeMasterCatalogService } from './nextpyme-master-catalog.service';

describe('NextPyme company catalogs', () => {
  it('carga recargos con el token de la empresa y rechaza una tabla vacía', async () => {
    const { service, client } = setup();
    await service.getPayrollOvertimeSurcharges('a');
    expect(client.fetchMasterTable).toHaveBeenCalledWith('type_overtime_surcharges', 'token-a');
    client.fetchMasterTable.mockResolvedValueOnce([]);
    await expect(service.getPayrollOvertimeSurcharges('b')).rejects.toThrow('recargos');
  });
  it('consulta únicamente payroll_type_document_identifications si NextPyme devuelve vacío', async () => {
    const { service, client } = setup();
    client.fetchMasterTable.mockImplementation(async (table: string, token: string) => table === 'payroll_type_document_identifications' ? [] : [{ id: 3, name: token }]);
    await expect(service.getPayrollWorkerCatalogs('a')).rejects.toThrow('tipos de documento');
    expect(client.fetchMasterTable).toHaveBeenCalledWith('payroll_type_document_identifications', 'token-a');
    expect(client.fetchMasterTable).not.toHaveBeenCalledWith('payroll_type_document_identification', expect.anything());
    expect(client.fetchMasterTable).not.toHaveBeenCalledWith('type_document_identifications', expect.anything());
  });
  it('propaga el error de la tabla exacta sin consultar variantes', async () => {
    const { service, client } = setup();
    client.fetchMasterTable.mockImplementation(async (table: string, token: string) => {
      if (table === 'payroll_type_document_identifications') throw new Error('Tabla no disponible');
      return [{ id: 3, name: token }];
    });
    await expect(service.getPayrollWorkerCatalogs('a')).rejects.toThrow('Tabla no disponible');
    expect(client.fetchMasterTable).not.toHaveBeenCalledWith('payroll_type_document_identification', expect.anything());
  });
  it('no acepta ni conserva en caché catálogos de documentos vacíos y permite reintentar', async () => {
    const { service, client } = setup();
    client.fetchMasterTable.mockImplementation(async (table: string, token: string) => table.startsWith('payroll_type_document_identifications') ? [] : [{ id: 1, name: token }]);
    await expect(service.getPayrollWorkerCatalogs('a')).rejects.toThrow('tipos de documento');
    client.fetchMasterTable.mockImplementation(async (_table: string, token: string) => [{ id: 3, name: token }]);
    expect((await service.getPayrollWorkerCatalogs('a')).identifications).toEqual([{ id: 3, name: 'token-a' }]);
  });
  it('consulta la tabla específica de documentos de nómina con el token de cada empresa', async () => {
    const { service, client } = setup();
    const result = await service.getPayrollWorkerCatalogs('payroll-company');
    expect(client.fetchMasterTable).toHaveBeenCalledWith('payroll_type_document_identifications', 'token-payroll-company');
    expect(client.fetchMasterTable).not.toHaveBeenCalledWith('type_document_identifications', expect.anything());
    expect(client.fetchMasterTable).toHaveBeenCalledWith('type_contracts', 'token-payroll-company');
    expect(result.identifications).toEqual([{ id: 1, name: 'token-payroll-company' }]);
    await service.getPayrollWorkerCatalogs('another-company');
    expect(client.fetchMasterTable).toHaveBeenCalledWith('payroll_type_document_identifications', 'token-another-company');
    await expect(service.getPayrollWorkerCatalogs('missing')).rejects.toThrow('token de NextPyme');
  });
  it.each(['non_vat_responsible', 'No responsable de IVA', '49'])('resuelve %s como no responsable sin confundirlo con el responsable', async value => {
    const { service, client } = setup();
    client.fetchMasterTable.mockResolvedValue([{ id: 1, code: '48', name: 'Responsable de IVA' }, { id: 2, code: '49', name: 'No responsable de IVA' }] as never);
    expect(await service.resolveRegimeId(value, 'a')).toBe(2);
    expect(await service.resolveRegimeId('vat_responsible', 'a')).toBe(1);
  });

  it('no convierte un régimen no responsable en responsable si falta el registro del catálogo', async () => {
    const { service, client } = setup();
    client.fetchMasterTable.mockResolvedValue([{ id: 1, code: '48', name: 'Responsable de IVA' }] as never);
    await expect(service.resolveRegimeId('non_vat_responsible', 'a')).rejects.toThrow('no responsable de IVA');
  });
  it('in local/QA only requires the company token, even without IDSoftware', async () => {
    const { service, client, integrations } = setup();
    client.usesTestResolutionEndpoint.mockReturnValue(true);
    await service.listResolutions('a');
    expect(client.listResolutions).toHaveBeenCalledWith('', 'token-a');
    expect(integrations.findByCompanyAndProvider).not.toHaveBeenCalled();
  });
  it.each([
    ['credit', 'credit_note_discrepancy_responses'],
    ['debit', 'debit_note_discrepancy_responses'],
  ] as const)('consulta motivos %s en su tabla maestra con el token de la empresa', async (kind, table) => {
    const { service, client } = setup();
    await service.getNoteDiscrepancyResponses(kind, 'notes-company');
    expect(client.fetchMasterTable).toHaveBeenCalledWith(table, 'token-notes-company');
  });
  function setup() {
    const companies = {
      findById: jest.fn(async (id: string) => ({
        nextPymeToken: id === 'missing' ? null : ` token-${id} `,
      })),
    };
    const integrations = {
      findByCompanyAndProvider: jest.fn(async (id: string) =>
        id === 'missing'
          ? null
          : { credentials: { id_software: ` software-${id} ` } },
      ),
    };
    const client = {
      usesTestResolutionEndpoint: jest.fn().mockReturnValue(false),
      listResolutions: jest.fn(async (idSoftware: string, token: string) => [
        { prefix: token, resolution: idSoftware },
      ]),
      fetchMasterTable: jest.fn(async (_table, token: string) => [
        { id: 1, name: token },
      ]),
    };
    const service = new NextPymeMasterCatalogService(
      client as any,
      companies as any,
      integrations as any,
    );
    return { service, client, integrations };
  }

  it('consults production resolutions with each company IDSoftware', async () => {
    const { service, client } = setup();
    const [a, b] = await Promise.all([
      service.listResolutions('a'),
      service.listResolutions('b'),
    ]);
    expect(a[0].resolution).toBe('software-a');
    expect(b[0].resolution).toBe('software-b');
    expect(client.listResolutions.mock.calls).toEqual([
      ['software-a', 'token-a'],
      ['software-b', 'token-b'],
    ]);
  });

  it('does not use a resolution technical key as IDSoftware', async () => {
    const { service, client, integrations } = setup();
    integrations.findByCompanyAndProvider.mockImplementation(
      async (_id: string, provider: string) =>
        provider === 'JARVIS'
          ? { credentials: { technical_key: ' fc8eac-clave ' } }
          : null,
    );

    await expect(service.listResolutions('a')).rejects.toThrow('IDSoftware');
    expect(client.listResolutions).not.toHaveBeenCalled();
  });

  it('rejects missing technical key even with a token', async () => {
    const { service, integrations } = setup();
    integrations.findByCompanyAndProvider.mockResolvedValue({
      credentials: {},
    });
    await expect(service.listResolutions('a')).rejects.toThrow(
      'IDSoftware',
    );
  });

  it('isolates cached and concurrent catalogs and rejects missing company tokens even with a warm cache', async () => {
    const { service, client } = setup();
    const [a, b] = await Promise.all([
      service.getTaxes('a'),
      service.getTaxes('b'),
    ]);
    expect(a[0].name).toBe('token-a');
    expect(b[0].name).toBe('token-b');
    await service.getTaxes('a');
    await expect(service.getTaxes('missing')).rejects.toThrow(
      'token de NextPyme',
    );
    expect(client.fetchMasterTable).toHaveBeenCalledTimes(2);
  });
});
