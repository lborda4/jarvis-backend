import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePayrollPaymentMethods1794100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE jarvis_payroll_payment_methods (
        id uuid PRIMARY KEY,
        company_id uuid NOT NULL REFERENCES companies(id),
        name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
        system_key varchar(20) CHECK (system_key IN ('cash', 'transfer')),
        nextpyme_method_id integer NOT NULL CHECK (nextpyme_method_id > 0),
        nextpyme_method_name varchar(255) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(company_id, system_key)
      );
      CREATE UNIQUE INDEX UQ_payroll_payment_method_name ON jarvis_payroll_payment_methods(company_id, lower(btrim(name)));
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE jarvis_payroll_payment_methods');
  }
}
