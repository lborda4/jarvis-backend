import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddJarvisHistoryDocumentKind1790900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jarvis_sales_invoices" ADD COLUMN "document_kind" varchar(30) NOT NULL DEFAULT 'ELECTRONIC_INVOICE'`);
    // The original migration created a constraint; TypeORM synchronization may replace it with an index.
    await queryRunner.query('ALTER TABLE "jarvis_sales_invoices" DROP CONSTRAINT IF EXISTS "UQ_jarvis_sales_invoices_number"');
    await queryRunner.query('DROP INDEX IF EXISTS "UQ_jarvis_sales_invoices_number"');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_jarvis_sales_invoices_number" ON "jarvis_sales_invoices" ("company_id", "document_kind", "prefix", "number")');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // Restoring the old uniqueness fails safely if both document types share a number.
    await queryRunner.query('DROP INDEX "UQ_jarvis_sales_invoices_number"');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_jarvis_sales_invoices_number" ON "jarvis_sales_invoices" ("company_id", "prefix", "number")');
    await queryRunner.query('ALTER TABLE "jarvis_sales_invoices" DROP COLUMN "document_kind"');
  }
}
