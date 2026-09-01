import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Job de importación de Factura de compra por Excel — permite correr el
 * procesamiento (consultas a NextPyme por CUFE, creación de documentos) en
 * segundo plano y que el frontend consulte el progreso, en vez de esperar
 * la respuesta del POST original (con 500+ filas eso supera el timeout del
 * cliente HTTP).
 */
export class CreatePurchaseInvoiceImportJobs1744200000000
  implements MigrationInterface
{
  name = 'CreatePurchaseInvoiceImportJobs1744200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "purchase_invoice_import_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "status" character varying NOT NULL DEFAULT 'running',
        "file_name" character varying,
        "processed_rows" integer NOT NULL DEFAULT 0,
        "total_rows" integer,
        "items_total" integer,
        "documents_created" integer,
        "document_ids" jsonb,
        "records" jsonb,
        "failed_rows" jsonb,
        "error_message" text,
        "started_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_purchase_invoice_import_jobs_company"
      ON "purchase_invoice_import_jobs" ("company_id", "started_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_purchase_invoice_import_jobs_company"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "purchase_invoice_import_jobs"`,
    );
  }
}
