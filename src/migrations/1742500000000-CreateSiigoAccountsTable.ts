import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSiigoAccountsTable1742500000000
  implements MigrationInterface
{
  name = 'CreateSiigoAccountsTable1742500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "siigo_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_siigo_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_siigo_accounts_company_integration_code"
          UNIQUE ("company_id", "integration_id", "code"),
        CONSTRAINT "FK_siigo_accounts_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_siigo_accounts_integration"
          FOREIGN KEY ("integration_id") REFERENCES "integrations"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_siigo_accounts_company_integration"
      ON "siigo_accounts" ("company_id", "integration_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "public"."IDX_siigo_accounts_company_integration"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "siigo_accounts"`);
  }
}
