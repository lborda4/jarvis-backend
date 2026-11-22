import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJarvisCertificateTerm1795500000000 implements MigrationInterface {
  name = 'AddJarvisCertificateTerm1795500000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    // Existing companies are queried only when a plan is next assigned, never during migration or a top-up.
    await queryRunner.query('ALTER TABLE integrations ADD COLUMN jarvis_certificate_term jsonb NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE integrations DROP COLUMN jarvis_certificate_term');
  }
}
