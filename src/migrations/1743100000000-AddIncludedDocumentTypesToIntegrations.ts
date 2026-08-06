import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIncludedDocumentTypesToIntegrations1743100000000
  implements MigrationInterface
{
  name = 'AddIncludedDocumentTypesToIntegrations1743100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      ADD COLUMN IF NOT EXISTS "included_document_types" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    await queryRunner.query(`
      UPDATE "integrations" AS integration
      SET "included_document_types" = COALESCE(
        plan."included_document_types",
        '["SUPPORT_DOCUMENT"]'::jsonb
      )
      FROM "plans" AS plan
      WHERE integration."plan_id" = plan."id"
        AND (
          integration."included_document_types" IS NULL
          OR integration."included_document_types" = '[]'::jsonb
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP COLUMN IF EXISTS "included_document_types"
    `);
  }
}
