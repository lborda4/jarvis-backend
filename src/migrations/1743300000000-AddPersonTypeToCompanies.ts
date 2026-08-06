import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPersonTypeToCompanies1743300000000
  implements MigrationInterface
{
  name = 'AddPersonTypeToCompanies1743300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "person_type" character varying(30)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "person_type"
    `);
  }
}
