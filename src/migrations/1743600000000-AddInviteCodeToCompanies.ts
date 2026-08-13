import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInviteCodeToCompanies1743600000000
  implements MigrationInterface
{
  name = 'AddInviteCodeToCompanies1743600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "invite_code" character varying(20)
    `);

    await queryRunner.query(`
      UPDATE "companies"
      SET "invite_code" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
      WHERE "invite_code" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      ALTER COLUMN "invite_code" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD CONSTRAINT "UQ_companies_invite_code" UNIQUE ("invite_code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP CONSTRAINT IF EXISTS "UQ_companies_invite_code"
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "invite_code"
    `);
  }
}
