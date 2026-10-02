import { NextPymeMasterCatalogService } from './nextpyme-master-catalog.service';

describe('NextPyme company catalogs', () => {
  function setup() {
    const companies = {
      findById: jest.fn(async (id: string) => ({
        nextPymeToken: id === 'missing' ? null : ` token-${id} `,
      })),
    };
    const client = {
      listResolutions: jest.fn(async (_filters, token: string) => [
        { prefix: token },
      ]),
      fetchMasterTable: jest.fn(async (_table, token: string) => [
        { id: 1, name: token },
      ]),
    };
    const service = new NextPymeMasterCatalogService(
      client as any,
      companies as any,
    );
    return { service, client };
  }

  it('consults each company resolutions with its own token', async () => {
    const { service, client } = setup();
    const [a, b] = await Promise.all([
      service.listResolutions('a'),
      service.listResolutions('b'),
    ]);
    expect(a[0].prefix).toBe('token-a');
    expect(b[0].prefix).toBe('token-b');
    expect(client.listResolutions.mock.calls).toEqual([
      [undefined, 'token-a'],
      [undefined, 'token-b'],
    ]);
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
