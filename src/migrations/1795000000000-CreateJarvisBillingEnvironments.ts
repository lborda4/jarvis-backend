import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisBillingEnvironments1795000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`CREATE TABLE jarvis_billing_environments (
      company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
      operations jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(queryRunner: QueryRunner) { await queryRunner.query('DROP TABLE jarvis_billing_environments'); }
}
