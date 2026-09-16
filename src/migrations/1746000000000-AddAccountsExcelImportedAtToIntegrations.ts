import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountsExcelImportedAtToIntegrations1746000000000
  implements MigrationInterface
{
  name = 'AddAccountsExcelImportedAtToIntegrations1746000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "accounts_excel_imported_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "accounts_excel_imported_at"
    `);
  }
}
