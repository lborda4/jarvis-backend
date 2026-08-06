import { MigrationInterface, QueryRunner } from 'typeorm';

export class MovePlansToIntegrations1743000000000
  implements MigrationInterface
{
  name = 'MovePlansToIntegrations1743000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "plans"
      ADD COLUMN IF NOT EXISTS "provider" character varying(50)
    `);

    await queryRunner.query(`
      ALTER TABLE "plans"
      ADD COLUMN IF NOT EXISTS "included_document_types" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      UPDATE "plans"
      SET
        "provider" = 'SIIGO',
        "included_document_types" = '["SUPPORT_DOCUMENT"]'::jsonb
      WHERE "provider" IS NULL
         OR "included_document_types" = '[]'::jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "plans"
      ALTER COLUMN "provider" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "plan_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "subscription_started_at" TIMESTAMP
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "subscription_status" character varying(30)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_integrations_plan'
        ) THEN
          ALTER TABLE "integrations"
          ADD CONSTRAINT "FK_integrations_plan"
          FOREIGN KEY ("plan_id") REFERENCES "plans"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE "integrations" AS integration
      SET
        "plan_id" = company."company_plan_id",
        "subscription_started_at" = COALESCE(
          integration."subscription_started_at",
          company."created_at",
          NOW()
        ),
        "subscription_status" = COALESCE(
          integration."subscription_status",
          'ACTIVE'
        )
      FROM "companies" AS company
      WHERE integration."company_id" = company."id"
        AND company."company_plan_id" IS NOT NULL
        AND integration."provider" = 'SIIGO'
        AND integration."plan_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP CONSTRAINT IF EXISTS "FK_companies_company_plan"
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "company_plan_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "company_plan_id" uuid
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_companies_company_plan'
        ) THEN
          ALTER TABLE "companies"
          ADD CONSTRAINT "FK_companies_company_plan"
          FOREIGN KEY ("company_plan_id") REFERENCES "plans"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE "companies" AS company
      SET "company_plan_id" = integration."plan_id"
      FROM "integrations" AS integration
      WHERE integration."company_id" = company."id"
        AND integration."provider" = 'SIIGO'
        AND integration."plan_id" IS NOT NULL
        AND company."company_plan_id" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP CONSTRAINT IF EXISTS "FK_integrations_plan"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "subscription_status"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "subscription_started_at"
    `);

    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "plan_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "plans"
      DROP COLUMN IF EXISTS "included_document_types"
    `);

    await queryRunner.query(`
      ALTER TABLE "plans"
      DROP COLUMN IF EXISTS "provider"
    `);
  }
}
