import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCostCenterToIntegrations1742000000000
  implements MigrationInterface
{
  name = 'AddCostCenterToIntegrations1742000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "cost_center" character varying(100)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "cost_center"
    `);
  }
}
