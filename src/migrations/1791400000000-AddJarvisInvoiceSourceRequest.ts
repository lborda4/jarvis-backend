import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddJarvisInvoiceSourceRequest1791400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE jarvis_sales_invoices ADD COLUMN IF NOT EXISTS source_request jsonb NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE jarvis_sales_invoices DROP COLUMN source_request');
  }
}
