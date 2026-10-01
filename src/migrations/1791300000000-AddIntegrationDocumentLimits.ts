import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddIntegrationDocumentLimits1791300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE integrations ADD COLUMN IF NOT EXISTS document_limits jsonb NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE integrations DROP COLUMN document_limits');
  }
}
