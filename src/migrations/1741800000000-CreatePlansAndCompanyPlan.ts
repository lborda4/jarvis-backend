import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlansAndCompanyPlan1741800000000
  implements MigrationInterface
{
  name = 'CreatePlansAndCompanyPlan1741800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plans" (
        "id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "code" character varying NOT NULL,
        "document_limit" integer,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_plans_code" UNIQUE ("code"),
        CONSTRAINT "PK_plans" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "plans" ("id", "name", "code", "document_limit", "active")
      VALUES
        ('11111111-1111-4111-8111-111111111101', 'Básico', 'basic', 100, true),
        ('11111111-1111-4111-8111-111111111102', 'Estándar', 'standard', 500, true),
        ('11111111-1111-4111-8111-111111111103', 'Ilimitado', 'unlimited', NULL, true)
      ON CONFLICT ("code") DO NOTHING
    `);

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
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "document_limit"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "document_limit" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP CONSTRAINT IF EXISTS "FK_companies_company_plan"
    `);

    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "company_plan_id"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "plans"`);
  }
}
