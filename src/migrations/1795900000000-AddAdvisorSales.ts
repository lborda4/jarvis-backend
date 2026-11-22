import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAdvisorSales1795900000000 implements MigrationInterface {
  name = 'AddAdvisorSales1795900000000';
  async up(runner: QueryRunner) {
    await runner.query("ALTER TABLE plans ADD COLUMN commission_class varchar(10) NULL CHECK (commission_class IN ('BASIC','PLUS','PRO')), ADD COLUMN sale_price_cop numeric(14,2) NULL CHECK (sale_price_cop >= 0)");
    await runner.query(`CREATE TABLE advisor_sales (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_key varchar(200) NOT NULL UNIQUE, operation_key varchar(120) NOT NULL,
      activation varchar(10) NOT NULL DEFAULT 'APPLIED' CHECK (activation IN ('PROCESSING','APPLIED','FAILED','UNCERTAIN')),
      advisor_id uuid NOT NULL REFERENCES advisors(id) ON DELETE RESTRICT, company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
      company_name varchar NOT NULL, company_nit varchar NOT NULL, provider varchar(10) NOT NULL, kind varchar(10) NOT NULL CHECK (kind IN ('PLAN','TOP_UP')),
      product_code varchar NOT NULL, product_name varchar NOT NULL, price_cop numeric(14,2) NOT NULL CHECK (price_cop >= 0),
      commission_class varchar(10) NOT NULL CHECK (commission_class IN ('BASIC','PLUS','PRO')), commission_rate integer NOT NULL,
      commission_cop numeric(14,2) NOT NULL CHECK (commission_cop >= 0), created_at timestamptz NOT NULL DEFAULT now(),
      paid_at timestamptz NULL, paid_by uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
      CHECK ((commission_class = 'BASIC' AND commission_rate = 10) OR (commission_class = 'PLUS' AND commission_rate = 15) OR (commission_class = 'PRO' AND commission_rate = 20)),
      CHECK ((paid_at IS NULL AND paid_by IS NULL) OR (paid_at IS NOT NULL AND paid_by IS NOT NULL))
    )`);
    await runner.query('CREATE INDEX advisor_sales_month_idx ON advisor_sales(advisor_id, paid_at)');
    await runner.query('CREATE INDEX advisor_sales_company_idx ON advisor_sales(company_id, operation_key)');
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE advisor_sales');
    await runner.query('ALTER TABLE plans DROP COLUMN commission_class, DROP COLUMN sale_price_cop');
  }
}
