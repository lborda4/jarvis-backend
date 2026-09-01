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
    // Un solo query: pg_advisory_xact_lock. A diferencia de
    // pg_advisory_lock/unlock (alcance sesión, inseguro detrás de un pooler
    // en modo transacción), el lock de transacción se libera solo al hacer
    // commit/rollback — no hace falta un unlock explícito.
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(calls[0][1]).toEqual(['company-1:SUPPORT_DOCUMENT']);
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
});
