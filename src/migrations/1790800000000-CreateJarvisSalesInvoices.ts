import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateJarvisSalesInvoices1790800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "jarvis_sales_invoices" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
      "provider_id" text NOT NULL, "prefix" varchar(30) NOT NULL, "number" varchar(80) NOT NULL,
      "issue_date" date NOT NULL, "customer_name" text NOT NULL, "customer_identification" varchar(100) NOT NULL,
      "currency" varchar(10) NOT NULL, "total" numeric(20,2) NOT NULL, "cufe" text,
      "sent_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_jarvis_sales_invoices_number" UNIQUE ("company_id", "prefix", "number")
    )`);
    await queryRunner.query('CREATE INDEX "IDX_jarvis_sales_invoices_company_sent" ON "jarvis_sales_invoices" ("company_id", "sent_at")');
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE "jarvis_sales_invoices"'); }
}
