import { JarvisRadianEventsRepository } from './jarvis-radian-events.repository';

function setup(rows: unknown[] = []) {
  const repo = {
    find: jest.fn().mockResolvedValue(rows),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const manager = { query: jest.fn(), getRepository: jest.fn(() => repo) };
  const source = {
    transaction: jest.fn(async (work) => work(manager)),
    query: jest.fn(),
  };
  return {
    service: new JarvisRadianEventsRepository(source as never),
    source,
    manager,
    repo,
  };
}
it('locks the whole invoice before checking or reserving any event', async () => {
  const { service, manager, repo } = setup();
  const claim = await service.claim('owner', 'cufe', 1, null);
  expect(manager.query).toHaveBeenCalledWith(
    expect.stringContaining('pg_advisory_xact_lock'),
    ['radian:owner:cufe'],
  );
  expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
    repo.find.mock.invocationCallOrder[0],
  );
  expect(claim).toMatchObject({
    claimed: true,
    row: { companyId: 'owner', status: 'processing' },
  });
});
it.each(['sent', 'processing', 'unknown'])(
  'does not claim an existing %s event',
  async (status) => {
    const { service, repo } = setup([{ eventId: 1, status }]);
    expect(await service.claim('owner', 'cufe', 1, null)).toMatchObject({
      claimed: false,
    });
    expect(repo.save).not.toHaveBeenCalled();
  },
);
it('blocks acceptance while a claim is unresolved', async () => {
  const { service } = setup([{ eventId: 2, status: 'unknown' }]);
  await expect(service.claim('owner', 'cufe', 4, null)).rejects.toThrow(
    'evento final',
  );
});
it('does not continue after an unconfirmed receipt', async () => {
  const { service } = setup([{ eventId: 1, status: 'unknown' }]);
  await expect(service.claim('owner', 'cufe', 3, null)).rejects.toThrow(
    'eventos anteriores',
  );
});
it('reserves a new attempt after a definite rejection', async () => {
  const { service } = setup([{ eventId: 1, status: 'failed' }]);
  expect(await service.claim('owner', 'cufe', 1, null)).toMatchObject({
    claimed: true,
    row: { status: 'processing', attemptId: expect.any(String) },
  });
});
