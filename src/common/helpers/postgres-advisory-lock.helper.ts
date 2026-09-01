import { DataSource } from 'typeorm';

/**
 * Ejecuta `fn` bajo un advisory lock de Postgres identificado por
 * `lockKey`, para serializar una sección crítica entre requests
 * concurrentes (incluso entre instancias distintas del backend, a
 * diferencia de un mutex en memoria).
 *
 * Usa `pg_advisory_xact_lock` (lock de alcance TRANSACCIÓN, se libera solo
 * al hacer COMMIT/ROLLBACK) en vez de `pg_advisory_lock`/`pg_advisory_unlock`
 * (alcance SESIÓN) a propósito: la conexión de Neon usada acá pasa por un
 * pooler en modo transacción (PgBouncer) — bajo ese modo, un mismo cliente
 * puede terminar hablando con un backend de Postgres distinto entre dos
 * queries separadas de "la misma" sesión lógica, así que un
 * pg_advisory_lock adquirido en una query puede terminar sin liberarse
 * nunca si el pg_advisory_unlock de después cae en otro backend — el lock
 * queda huérfano en el backend original para siempre (esto pasó en
 * producción: un lock de cupo de Factura de compra quedó trabado y bloqueó
 * cada import siguiente indefinidamente). Un lock de transacción no tiene
 * este problema: el pooler en modo transacción sí garantiza que una
 * transacción abierta se sirve siempre por el mismo backend de principio a
 * fin, así que abrir la transacción, tomar el lock, correr `fn`, y cerrar
 * la transacción queda todo pinneado al mismo backend sin necesidad de un
 * unlock explícito.
 */
export async function withPostgresAdvisoryLock<T>(
  dataSource: DataSource,
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();

  try {
    await queryRunner.query(
      'SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',
      [lockKey],
    );

    const result = await fn();
    await queryRunner.commitTransaction();

    return result;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
