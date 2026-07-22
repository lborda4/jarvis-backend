import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLegacyIntegrationAndCompanyColumns1742300000000
  implements MigrationInterface
{
  name = 'RemoveLegacyIntegrationAndCompanyColumns1742300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "cost_center"
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "dian_cookie"
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "auto_apply"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "cost_center" character varying(100)
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "dian_cookie" text
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "auto_apply" boolean NOT NULL DEFAULT false
    `);
  }
}
