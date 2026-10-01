import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddJarvisInvoiceXml1791500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE jarvis_sales_invoices ADD COLUMN IF NOT EXISTS invoice_xml text NULL'); }
  async down(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE jarvis_sales_invoices DROP COLUMN invoice_xml'); }
}
