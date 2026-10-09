import { IntegrationLogoService, logoMime, MAX_LOGO_BYTES } from './integration-logo.service';
import { IntegrationProvider } from './enums/integration-provider.enum';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZAAAAABJRU5ErkJggg==', 'base64');
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
]);
describe('integration logos', () => {
  const provider = IntegrationProvider.JARVIS;
  function setup(logo: Buffer | null = null) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue({ logo }) };
    const repository = { createQueryBuilder: jest.fn(() => query), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const nextPymeApiClient = { putConfigLogo: jest.fn().mockResolvedValue({}) };
    const nextPymeMasterCatalog = { requireCompanyToken: jest.fn().mockResolvedValue('company-token') };
    return {
      service: new IntegrationLogoService(repository as never, nextPymeApiClient as never, nextPymeMasterCatalog as never),
      query,
      repository,
      nextPymeApiClient,
      nextPymeMasterCatalog,
    };
  }
  it('accepts PNG content and rejects oversized, non-image and excessive dimensions', () => {
    expect(logoMime(png)).toBe('image/png');
    expect(logoMime(jpeg)).toBe('image/jpeg');
    expect(() => logoMime(Buffer.alloc(MAX_LOGO_BYTES + 1))).toThrow('500 KB');
    expect(() => logoMime(Buffer.from('<svg/>'))).toThrow();
    const huge = Buffer.from(png); huge.writeUInt32BE(10000, 16);
    expect(() => logoMime(huge)).toThrow('4096');
  });
  it('loads only the authenticated company integration', async () => {
    const { service, query } = setup(png);
    expect((await service.get('owner', provider)).logoDataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`);
    expect(query.where).toHaveBeenCalledWith('integration.companyId = :companyId', { companyId: 'owner' });
    expect(query.andWhere).toHaveBeenCalledWith('integration.provider = :provider', { provider });
  });
  it('allows a company without a logo', async () => {
    expect(await setup().service.get('owner', provider)).toEqual({ logoDataUrl: null });
  });
  it('saves binary content and removes it without changing other integration settings', async () => {
    const { service, repository, nextPymeApiClient } = setup();
    await service.save('owner', IntegrationProvider.SIIGO, { buffer: png } as Express.Multer.File);
    expect(nextPymeApiClient.putConfigLogo).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith({ companyId: 'owner', provider: IntegrationProvider.SIIGO, active: true }, { logo: png });
    await service.remove('owner', provider);
    expect(repository.update).toHaveBeenLastCalledWith({ companyId: 'owner', provider, active: true }, { logo: null });
  });

  it('envía el JPG a NextPyme al guardar logo JARVIS y luego lo persiste', async () => {
    const { service, repository, nextPymeApiClient, nextPymeMasterCatalog } = setup();
    await service.save('owner', provider, { buffer: jpeg } as Express.Multer.File);
    expect(nextPymeMasterCatalog.requireCompanyToken).toHaveBeenCalledWith('owner');
    expect(nextPymeApiClient.putConfigLogo).toHaveBeenCalledWith(jpeg.toString('base64'), 'company-token');
    expect(repository.update).toHaveBeenCalledWith({ companyId: 'owner', provider, active: true }, { logo: jpeg });
  });

  it('rechaza PNG en JARVIS y no llama a NextPyme', async () => {
    const { service, repository, nextPymeApiClient } = setup();
    await expect(service.save('owner', provider, { buffer: png } as Express.Multer.File)).rejects.toThrow('JPG');
    expect(nextPymeApiClient.putConfigLogo).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('no persiste el logo JARVIS si NextPyme rechaza el PUT', async () => {
    const { service, repository, nextPymeApiClient } = setup();
    nextPymeApiClient.putConfigLogo.mockRejectedValue(new Error('NextPyme'));
    await expect(service.save('owner', provider, { buffer: jpeg } as Express.Multer.File)).rejects.toThrow('NextPyme');
    expect(repository.update).not.toHaveBeenCalled();
  });
  it('rejects missing files and missing integrations', async () => {
    const { service, repository, query } = setup();
    await expect(service.save('owner', provider)).rejects.toThrow();
    expect(repository.update).not.toHaveBeenCalled();
    repository.update.mockResolvedValue({ affected: 0 });
    await expect(service.save('owner', provider, { buffer: jpeg } as Express.Multer.File)).rejects.toThrow();
    query.getOne.mockResolvedValue(null);
    await expect(service.get('other', provider)).rejects.toThrow();
  });
});
