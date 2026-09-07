import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastBalanceTrialAutoSyncAtToIntegrations1745500000000
  implements MigrationInterface
{
  name = 'AddLastBalanceTrialAutoSyncAtToIntegrations1745500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "last_balance_trial_auto_sync_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "last_balance_trial_auto_sync_at"
    `);
  }
}
