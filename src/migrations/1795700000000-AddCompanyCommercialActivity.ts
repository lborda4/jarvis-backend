import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddCompanyCommercialActivity1795700000000 implements MigrationInterface {
  name = 'AddCompanyCommercialActivity1795700000000';
  async up(runner: QueryRunner) { await runner.query(`ALTER TABLE companies ADD COLUMN commercial_activity jsonb NOT NULL DEFAULT '[]'::jsonb`); }
  async down(runner: QueryRunner) { await runner.query('ALTER TABLE companies DROP COLUMN commercial_activity'); }
}
