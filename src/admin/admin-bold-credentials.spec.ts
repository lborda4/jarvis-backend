import { AdminService } from './admin.service';
describe('Admin Bold credentials', () => {
  function setup(credentials = {}) {
    const integration = {
      id: 'bold-1',
      companyId: 'company-1',
      provider: 'BOLD',
      credentials,
    };
    const repository = {
      findByCompanyAndProvider: jest.fn().mockResolvedValue(integration),
      save: jest.fn().mockResolvedValue(integration),
    };
    const service = new AdminService(
      {} as never,
      {} as never,
      {} as never,
      repository as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, repository, integration };
  }
  it('saves both keys in the existing credentials JSON and preserves other fields', async () => {
    const { service, repository, integration } = setup({ unrelated: 'keep' });
    const result = await service.saveBoldCredentials('company-1', {
      identityKey: ' identity ',
      secretKey: ' secret ',
    });
    expect(repository.findByCompanyAndProvider).toHaveBeenCalledWith(
      'company-1',
      'BOLD',
    );
    expect(integration.credentials).toEqual({
      unrelated: 'keep',
      identity_key: 'identity',
      secret_key: 'secret',
    });
    expect(repository.save).toHaveBeenCalledWith(integration);
    expect(result).toEqual({ identityKey: 'identity', hasSecretKey: true });
  });
  it('never returns the stored secret', async () => {
    const { service } = setup({
      identity_key: 'identity',
      secret_key: 'private',
    });
    expect(await service.getBoldCredentials('company-1')).toEqual({
      identityKey: 'identity',
      hasSecretKey: true,
    });
  });
  it('preserves the secret when the form leaves it blank', async () => {
    const { service, integration } = setup({ secret_key: 'existing' });
    await service.saveBoldCredentials('company-1', {
      identityKey: 'updated',
      secretKey: '',
    });
    expect(integration.credentials).toMatchObject({
      secret_key: 'existing',
      identity_key: 'updated',
    });
  });
  it('requires both keys for the first configuration', async () => {
    const { service, repository } = setup();
    await expect(
      service.saveBoldCredentials('company-1', { identityKey: 'identity' }),
    ).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('does not save credentials in another integration when Bold is missing', async () => {
    const { service, repository } = setup();
    repository.findByCompanyAndProvider.mockResolvedValue(null);
    await expect(
      service.saveBoldCredentials('company-1', {
        identityKey: 'id',
        secretKey: 'secret',
      }),
    ).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });
  it('rejects an empty identity key', async () => {
    const { service, repository } = setup();
    await expect(
      service.saveBoldCredentials('company-1', {
        identityKey: ' ',
        secretKey: 'secret',
      }),
    ).rejects.toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });
});
