import { IntegrationLogoService, logoMime, MAX_LOGO_BYTES } from './integration-logo.service';
import { IntegrationProvider } from './enums/integration-provider.enum';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZAAAAABJRU5ErkJggg==', 'base64');
describe('integration logos', () => {
  const provider = IntegrationProvider.JARVIS;
  function setup(logo: Buffer | null = null) {
    const query = { addSelect: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue({ logo }) };
    const repository = { createQueryBuilder: jest.fn(() => query), update: jest.fn().mockResolvedValue({ affected: 1 }) };
    return { service: new IntegrationLogoService(repository as never), query, repository };
  }
  it('accepts PNG content and rejects oversized, non-image and excessive dimensions', () => {
    expect(logoMime(png)).toBe('image/png');
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
    const { service, repository } = setup();
    await service.save('owner', provider, { buffer: png } as Express.Multer.File);
    expect(repository.update).toHaveBeenCalledWith({ companyId: 'owner', provider, active: true }, { logo: png });
    await service.remove('owner', provider);
    expect(repository.update).toHaveBeenLastCalledWith({ companyId: 'owner', provider, active: true }, { logo: null });
  });
  it('rejects missing files and missing integrations', async () => {
    const { service, repository, query } = setup();
    await expect(service.save('owner', provider)).rejects.toThrow();
    expect(repository.update).not.toHaveBeenCalled();
    repository.update.mockResolvedValue({ affected: 0 });
    await expect(service.save('owner', provider, { buffer: png } as Express.Multer.File)).rejects.toThrow();
    query.getOne.mockResolvedValue(null);
    await expect(service.get('other', provider)).rejects.toThrow();
  });
});
