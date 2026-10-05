import type { DataSource, QueryRunner } from 'typeorm';
import { withPostgresAdvisoryLock } from './postgres-advisory-lock.helper';

function buildFakeDataSource(queryRunner: Partial<QueryRunner>): DataSource {
  return {
    createQueryRunner: () => queryRunner,
  } as unknown as DataSource;
}

describe('withPostgresAdvisoryLock', () => {
  it('abre una transacción, toma el lock de transacción, corre fn, hace commit y libera la conexión', async () => {
    const calls: unknown[][] = [];
    const queryMock = jest.fn((sql: string, params?: unknown[]) => {
      calls.push([sql, params]);
      return Promise.resolve([]);
    });
    const queryRunner: Partial<QueryRunner> = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: queryMock as unknown as QueryRunner['query'],
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = buildFakeDataSource(queryRunner);

    const result = await withPostgresAdvisoryLock(
      dataSource,
      'company-1:SUPPORT_DOCUMENT',
      () => Promise.resolve('done'),
    );

    expect(result).toBe('done');
    expect(queryRunner.connect).toHaveBeenCalledTimes(1);
    expect(queryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.rollbackTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
    expect(calls[0][0]).toContain('SET LOCAL lock_timeout');
    expect(calls[1][0]).toContain('idle_in_transaction_session_timeout');
    expect(calls[2][0]).toContain('pg_advisory_xact_lock');
    expect(calls[2][1]).toEqual(['company-1:SUPPORT_DOCUMENT']);
  });

  it('hace rollback y libera la conexión igual si fn lanza', async () => {
    const queryRunner: Partial<QueryRunner> = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([]),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = buildFakeDataSource(queryRunner);

    await expect(
      withPostgresAdvisoryLock(dataSource, 'company-1:SUPPORT_DOCUMENT', () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['company-1:SUPPORT_DOCUMENT'],
    );
  });

  it('no deja la conexión colgada: si el lock no se obtiene a tiempo, falla en vez de esperar indefinido', async () => {
    const queryRunner: Partial<QueryRunner> = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation((sql: string) => {
        if (String(sql).includes('pg_advisory_xact_lock')) {
          return Promise.reject(new Error('canceling statement due to lock timeout'));
        }
        return Promise.resolve([]);
      }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = buildFakeDataSource(queryRunner);

    await expect(
      withPostgresAdvisoryLock(dataSource, 'company-1:SUPPORT_DOCUMENT', () =>
        Promise.resolve('done'),
      ),
    ).rejects.toThrow(/otro envío de este documento en curso/i);

    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
