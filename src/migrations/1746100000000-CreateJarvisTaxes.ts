import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisTaxes1746100000000 implements MigrationInterface {
  name = 'CreateJarvisTaxes1746100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "jarvis_taxes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "category" character varying(32) NOT NULL,
        "code" character varying(32) NOT NULL,
        "name" character varying(255) NOT NULL,
        "tax_type" character varying(128) NOT NULL,
        "is_value_based" boolean NOT NULL DEFAULT false,
        "rate" numeric(12,4),
        "is_active" boolean NOT NULL DEFAULT true,
        "is_in_use" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_jarvis_taxes_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_jarvis_taxes_integration"
          FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jarvis_taxes_company_code"
      ON "jarvis_taxes" ("company_id", "code")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_jarvis_taxes_company_category"
      ON "jarvis_taxes" ("company_id", "category")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_jarvis_taxes_company_category"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_jarvis_taxes_company_code"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "jarvis_taxes"`);
  }
}
