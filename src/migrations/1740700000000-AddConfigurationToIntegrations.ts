import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfigurationToIntegrations1740700000000
  implements MigrationInterface
{
  name = 'AddConfigurationToIntegrations1740700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN "configuration" jsonb NOT NULL DEFAULT '{}'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN "configuration"
    `);
  }
}
