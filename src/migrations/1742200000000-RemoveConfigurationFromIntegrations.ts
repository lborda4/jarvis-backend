import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveConfigurationFromIntegrations1742200000000
  implements MigrationInterface
{
  name = 'RemoveConfigurationFromIntegrations1742200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "configuration"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "configuration" jsonb NOT NULL DEFAULT '{}'
    `);
  }
}
