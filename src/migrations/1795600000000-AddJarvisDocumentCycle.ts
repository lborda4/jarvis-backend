import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJarvisDocumentCycle1795600000000 implements MigrationInterface {
  name = 'AddJarvisDocumentCycle1795600000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE integrations ADD COLUMN jarvis_document_cycle jsonb NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE integrations DROP COLUMN jarvis_document_cycle');
  }
}
