import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisPaymentMethods1791000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE jarvis_payment_methods (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name varchar(120) NOT NULL,
      nextpyme_method_id integer NOT NULL CHECK (nextpyme_method_id > 0),
      nextpyme_method_name varchar(255) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE INDEX "IDX_jarvis_payment_methods_company" ON jarvis_payment_methods(company_id)');
    await queryRunner.query('CREATE UNIQUE INDEX "UQ_jarvis_payment_methods_name" ON jarvis_payment_methods(company_id, lower(name))');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE jarvis_payment_methods');
  }
}
