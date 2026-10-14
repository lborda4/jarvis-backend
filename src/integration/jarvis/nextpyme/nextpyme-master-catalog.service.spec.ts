import { NextPymeMasterCatalogService } from './nextpyme-master-catalog.service';

describe('NextPyme company catalogs', () => {
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

  it('consults each company resolutions with its own token and IDSoftware', async () => {
    const { service, client } = setup();
    const [a, b] = await Promise.all([
      service.listResolutions('a'),
      service.listResolutions('b'),
    ]);
    expect(a[0].prefix).toBe('token-a');
    expect(b[0].prefix).toBe('token-b');
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
