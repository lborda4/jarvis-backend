import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persiste la fila original del Excel (DianSalesInvoiceRow) por cada
 * PurchaseInvoiceImportJobRow — hasta ahora solo vivía en memoria durante el
 * run. Sin esto, reanudar un job tras un reinicio del servidor o reintentar
 * solo las filas fallidas no tiene de dónde recuperar los datos de la fila;
 * con esto, Postgres es la fuente de verdad completa, independiente de lo
 * que BullMQ/Redis todavía tengan en memoria.
 */
export class AddRawRowToPurchaseInvoiceImportJobRows1744600000000
  implements MigrationInterface
{
  name = 'AddRawRowToPurchaseInvoiceImportJobRows1744600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_invoice_import_job_rows"
      ADD COLUMN IF NOT EXISTS "raw_row" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_invoice_import_job_rows"
      DROP COLUMN IF EXISTS "raw_row"
    `);
  }
}
