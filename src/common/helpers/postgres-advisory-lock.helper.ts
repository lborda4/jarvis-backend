import { DataSource } from 'typeorm';

/**
 * Ejecuta `fn` bajo un advisory lock de Postgres identificado por
 * `lockKey`, para serializar una sección crítica entre requests
 * concurrentes (incluso entre instancias distintas del backend, a
 * diferencia de un mutex en memoria). El lock vive en una conexión
 * dedicada y se libera siempre, incluso si `fn` lanza.
 *
 * Pensado para operaciones cortas pero que no pueden ejecutarse dos veces
 * en simultáneo para la misma llave (ej. asignar el próximo consecutivo de
 * una resolución DIAN), aunque `fn` incluya llamadas HTTP externas.
 */
export async function withPostgresAdvisoryLock<T>(
  dataSource: DataSource,
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    await queryRunner.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [
      lockKey,
    ]);

    return await fn();
  } finally {
    try {
      await queryRunner.query(
        'SELECT pg_advisory_unlock(hashtext($1)::bigint)',
        [lockKey],
      );
    } finally {
      await queryRunner.release();
    }
  }
}
