import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soporte para la cola basada en PostgreSQL (SELECT ... FOR UPDATE SKIP
 * LOCKED) que reemplaza a BullMQ/Redis: `processing_at` permite detectar
 * filas abandonadas (worker caído a mitad de proceso) y `attempts` cuenta
 * cuántas veces un worker reclamó cada fila.
 */
export class AddWorkerColumnsToPurchaseInvoiceImportJobRows1744700000000
  implements MigrationInterface
{
  name = 'AddWorkerColumnsToPurchaseInvoiceImportJobRows1744700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_invoice_import_job_rows"
      ADD COLUMN IF NOT EXISTS "processing_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_invoice_import_job_rows"
      DROP COLUMN IF EXISTS "attempts",
      DROP COLUMN IF EXISTS "processing_at"
    `);
  }
}
