import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyIdToIntegrations1741300000000
  implements MigrationInterface
{
  name = 'AddCompanyIdToIntegrations1741300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "company_id" uuid
    `);

    await queryRunner.query(`
      UPDATE "integrations" i
      SET "company_id" = (
        SELECT c.id FROM "companies" c ORDER BY c.created_at ASC LIMIT 1
      )
      WHERE i."company_id" IS NULL
        AND EXISTS (SELECT 1 FROM "companies" c)
    `);

    await queryRunner.query(`
      DELETE FROM "integrations"
      WHERE "company_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      ALTER COLUMN "company_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP CONSTRAINT IF EXISTS "UQ_integrations_provider"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP CONSTRAINT IF EXISTS "integrations_provider_key"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD CONSTRAINT "FK_integrations_company"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_integrations_company_provider"
      ON "integrations" ("company_id", "provider")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_integrations_company_provider"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP CONSTRAINT IF EXISTS "FK_integrations_company"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "company_id"
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_integrations_provider"
      ON "integrations" ("provider")
    `);
  }
}
