import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Detalle por fila de un job de importación de Factura de compra — se
 * inserta con status='pending' antes de procesar nada (tolerancia a
 * fallos: si el servidor se cae a mitad de camino, queda registrado
 * exactamente qué filas se alcanzaron a procesar) y se actualiza por
 * lotes a medida que avanza el import.
 */
export class CreatePurchaseInvoiceImportJobRows1744300000000
  implements MigrationInterface
{
  name = 'CreatePurchaseInvoiceImportJobRows1744300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "purchase_invoice_import_job_rows" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "job_id" uuid NOT NULL REFERENCES "purchase_invoice_import_jobs"("id") ON DELETE CASCADE,
        "row_index" integer NOT NULL,
        "cufe" character varying NOT NULL,
        "issuer_nit" character varying NOT NULL,
        "issuer_name" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "error_message" text,
        "document_id" uuid,
        "processed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_invoice_import_job_rows_job"
      ON "purchase_invoice_import_job_rows" ("job_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_invoice_import_job_rows_job_order"
      ON "purchase_invoice_import_job_rows" ("job_id", "row_index")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_purchase_invoice_import_job_rows_job_order"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_purchase_invoice_import_job_rows_job"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "purchase_invoice_import_job_rows"`,
    );
  }
}
