import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedDocumentQuotaPlans1793200000000 implements MigrationInterface {
  name = 'SeedDocumentQuotaPlans1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "plans" (
        "id", "name", "code", "provider", "document_limit",
        "included_document_types", "active"
      )
      SELECT
        gen_random_uuid(),
        provider || ' ' || quota || ' documentos',
        lower(provider) || '_documents_' || quota,
        provider,
        quota,
        '["SUPPORT_DOCUMENT"]'::jsonb,
        true
      FROM (VALUES ('SIIGO'), ('JARVIS')) AS providers(provider)
      CROSS JOIN (VALUES (20), (50), (100), (200)) AS quotas(quota)
      WHERE NOT EXISTS (
        SELECT 1 FROM "plans" existing
        WHERE existing."provider" = providers.provider
          AND existing."document_limit" = quotas.quota
          AND existing."active" = true
      )
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "plans"
      WHERE "code" IN (
        'siigo_documents_20', 'siigo_documents_50',
        'siigo_documents_100', 'siigo_documents_200',
        'jarvis_documents_20', 'jarvis_documents_50',
        'jarvis_documents_100', 'jarvis_documents_200'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "integrations" WHERE "plan_id" = "plans"."id"
      )
    `);
  }
}