import { MigrationInterface, QueryRunner } from "typeorm";
export class CreatePayrollModule1793600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE jarvis_payroll_settings (
      company_id uuid PRIMARY KEY REFERENCES companies(id), settings jsonb NOT NULL DEFAULT '{}', next_number bigint NOT NULL DEFAULT 1 CHECK(next_number>0), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE jarvis_payroll_parameters (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), valid_from date NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,valid_from));
      CREATE TABLE jarvis_payroll_positions (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), code varchar(30) NOT NULL, name varchar(150) NOT NULL, salary numeric(14,2) NOT NULL CHECK(salary>=0), active boolean NOT NULL DEFAULT true, UNIQUE(company_id,code));
      CREATE TABLE jarvis_payroll_employees (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), identification varchar(30) NOT NULL, data jsonb NOT NULL, active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,identification));
      CREATE TABLE jarvis_payroll_documents (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), employee_id uuid NOT NULL REFERENCES jarvis_payroll_employees(id), original_id uuid REFERENCES jarvis_payroll_documents(id), state jsonb NOT NULL,
      employee_snapshot jsonb NOT NULL, parameter_snapshot jsonb NOT NULL, status varchar(25) NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','PROCESSING','ACCEPTED','REJECTED','UNCERTAIN')),
      number bigint, prefix varchar(20), cune text, sent_at timestamptz, accrued numeric(14,2) NOT NULL, deductions numeric(14,2) NOT NULL, net numeric(14,2) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,prefix,number));
      CREATE UNIQUE INDEX UQ_payroll_employee_period ON jarvis_payroll_documents(company_id,employee_id,(state->>'startDate'),(state->>'endDate')) WHERE original_id IS NULL;
      CREATE TABLE jarvis_payroll_transmissions (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), document_id uuid NOT NULL REFERENCES jarvis_payroll_documents(id), request jsonb NOT NULL, response jsonb, validation jsonb, error text,
      created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
      CREATE INDEX IX_payroll_company_period ON jarvis_payroll_documents(company_id,(state->>'period'));
      CREATE INDEX IX_payroll_transmissions ON jarvis_payroll_transmissions(company_id,document_id);
      CREATE TABLE jarvis_payroll_audit (id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), actor_id text NOT NULL, action varchar(80) NOT NULL, resource_id uuid, created_at timestamptz NOT NULL DEFAULT now());`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      "DROP TABLE jarvis_payroll_audit, jarvis_payroll_transmissions, jarvis_payroll_documents, jarvis_payroll_employees, jarvis_payroll_positions, jarvis_payroll_parameters, jarvis_payroll_settings",
    );
  }
}
