import type { DataSource, QueryRunner } from 'typeorm';
import { withPostgresAdvisoryLock } from './postgres-advisory-lock.helper';

function buildFakeDataSource(queryRunner: Partial<QueryRunner>): DataSource {
  return {
    createQueryRunner: () => queryRunner,
  } as unknown as DataSource;
}

describe('withPostgresAdvisoryLock', () => {
  it('acquires the lock, runs fn, then releases the lock and connection', async () => {
    const calls: unknown[][] = [];
    const queryMock = jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push([sql, params]);
      return [];
    });
    const queryRunner: Partial<QueryRunner> = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: queryMock as unknown as QueryRunner['query'],
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = buildFakeDataSource(queryRunner);

    const result = await withPostgresAdvisoryLock(
      dataSource,
      'company-1:SUPPORT_DOCUMENT',
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain('pg_advisory_lock');
    expect(calls[0][1]).toEqual(['company-1:SUPPORT_DOCUMENT']);
    expect(calls[1][0]).toContain('pg_advisory_unlock');
    expect(calls[1][1]).toEqual(['company-1:SUPPORT_DOCUMENT']);
  });

  it('releases the lock and connection even when fn throws', async () => {
    const queryRunner: Partial<QueryRunner> = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]) as unknown as QueryRunner['query'],
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = buildFakeDataSource(queryRunner);

    await expect(
      withPostgresAdvisoryLock(dataSource, 'company-1:SUPPORT_DOCUMENT', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      ['company-1:SUPPORT_DOCUMENT'],
    );
  });
});
