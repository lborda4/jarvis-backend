import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El detalle fila-a-fila (éxito/error por CUFE) ahora vive en
 * purchase_invoice_import_job_rows, incremental desde el arranque del job —
 * la columna failed_rows (un blob escrito una sola vez al final) queda
 * redundante. validation_report guarda el reporte completo de la pasada de
 * validación previa cuando el job aborta por filas inválidas del Excel.
 */
export class AddValidationToPurchaseInvoiceImportJobs1744400000000
  implements MigrationInterface
{
  name = 'AddValidationToPurchaseInvoiceImportJobs1744400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_invoice_import_jobs"
      ADD COLUMN IF NOT EXISTS "validation_report" jsonb,
      DROP COLUMN IF EXISTS "failed_rows"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "purchase_invoice_import_jobs"
      ADD COLUMN IF NOT EXISTS "failed_rows" jsonb,
      DROP COLUMN IF EXISTS "validation_report"
    `);
  }
}
