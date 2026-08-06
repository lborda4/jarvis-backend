import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisTerceros1743200000000 implements MigrationInterface {
  name = 'CreateJarvisTerceros1743200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "jarvis_terceros" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "document_type" character varying(16) NOT NULL,
        "document_number" character varying(32) NOT NULL,
        "check_digit" character varying(2),
        "name" character varying(255) NOT NULL,
        "entity_type" character varying(32),
        "tax_regime" character varying(32),
        "email" character varying(255),
        "phone" character varying(64),
        "address" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "FK_jarvis_terceros_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_jarvis_terceros_integration"
          FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_jarvis_terceros_company_document"
      ON "jarvis_terceros" ("company_id", "document_type", "document_number")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_jarvis_terceros_company_id"
      ON "jarvis_terceros" ("company_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_jarvis_terceros_company_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_jarvis_terceros_company_document"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "jarvis_terceros"`);
  }
}
