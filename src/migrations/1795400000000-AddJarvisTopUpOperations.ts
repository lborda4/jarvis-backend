import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJarvisTopUpOperations1795400000000 implements MigrationInterface {
  name = 'AddJarvisTopUpOperations1795400000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    // Previous commercial selections were quotes, not credited purchases. Do not backfill balances from them.
    await queryRunner.query(`ALTER TABLE integrations ADD COLUMN top_up_operations jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query('ALTER TABLE integrations ADD COLUMN pending_initial_documents integer NOT NULL DEFAULT 0');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE integrations DROP COLUMN top_up_operations');
    await queryRunner.query('ALTER TABLE integrations DROP COLUMN pending_initial_documents');
  }
}
