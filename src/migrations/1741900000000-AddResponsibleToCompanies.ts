import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResponsibleToCompanies1741900000000
  implements MigrationInterface
{
  name = 'AddResponsibleToCompanies1741900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "responsible" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "responsible"
    `);
  }
}
