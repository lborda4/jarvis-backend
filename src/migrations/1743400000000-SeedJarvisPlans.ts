import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedJarvisPlans1743400000000 implements MigrationInterface {
  name = 'SeedJarvisPlans1743400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "plans" (
        "id",
        "name",
        "code",
        "provider",
        "document_limit",
        "included_document_types",
        "active"
      )
      VALUES
        (
          '21111111-1111-4111-8111-111111111101',
          'Básico',
          'jarvis_basic',
          'JARVIS',
          100,
          '["SUPPORT_DOCUMENT"]'::jsonb,
          true
        ),
        (
          '21111111-1111-4111-8111-111111111102',
          'Estándar',
          'jarvis_standard',
          'JARVIS',
          500,
          '["SUPPORT_DOCUMENT"]'::jsonb,
          true
        ),
        (
          '21111111-1111-4111-8111-111111111103',
          'Ilimitado',
          'jarvis_unlimited',
          'JARVIS',
          NULL,
          '["SUPPORT_DOCUMENT"]'::jsonb,
          true
        )
      ON CONFLICT ("code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "plans"
      WHERE "code" IN ('jarvis_basic', 'jarvis_standard', 'jarvis_unlimited')
    `);
  }
}
