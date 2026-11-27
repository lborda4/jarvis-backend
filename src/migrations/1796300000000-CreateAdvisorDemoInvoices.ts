import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdvisorDemoInvoices1796300000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`ALTER TABLE advisor_demo_company ADD COLUMN next_invoice_number bigint NOT NULL DEFAULT 1`);
    await runner.query(`CREATE TABLE advisor_demo_invoices (
      id uuid PRIMARY KEY,
      number bigint NOT NULL UNIQUE,
      customer_name varchar(200) NOT NULL,
      customer_identification varchar(100) NOT NULL,
      description varchar(500) NOT NULL,
      quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
      unit_value numeric(14,2) NOT NULL CHECK (unit_value > 0),
      total numeric(18,2) NOT NULL CHECK (total > 0),
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  }

  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE advisor_demo_invoices');
    await runner.query('ALTER TABLE advisor_demo_company DROP COLUMN next_invoice_number');
  }
}
