import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIntegrations1739900000000 implements MigrationInterface {
  name = 'CreateIntegrations1739900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "integrations" (
        "id" uuid NOT NULL,
        "provider" character varying(50) NOT NULL,
        "credentials" jsonb NOT NULL DEFAULT '{}',
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_integrations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_integrations_provider" UNIQUE ("provider")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "integrations"
      DROP CONSTRAINT IF EXISTS "UQ_integrations_provider"
    `);

    await queryRunner.query(`
      DROP TABLE "integrations"
    `);
  }
}
