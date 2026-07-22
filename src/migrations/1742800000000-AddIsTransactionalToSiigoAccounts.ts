import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsTransactionalToSiigoAccounts1742800000000
  implements MigrationInterface
{
  name = 'AddIsTransactionalToSiigoAccounts1742800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "siigo_accounts"
      ADD COLUMN IF NOT EXISTS "is_transactional" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "siigo_accounts"
      DROP COLUMN IF EXISTS "is_transactional"
    `);
  }
}
