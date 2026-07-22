import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsAdminAndDocumentLimitToIntegrations1741600000000
  implements MigrationInterface
{
  name = 'AddIsAdminAndDocumentLimitToIntegrations1741600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "role" character varying(50) NOT NULL DEFAULT 'user'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "role"
    `);
  }
}
