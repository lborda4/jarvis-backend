import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPrivacyConsent1792000000000 implements MigrationInterface {
  name = 'AddUserPrivacyConsent1792000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "accepted_privacy_at" TIMESTAMP, ADD COLUMN IF NOT EXISTS "privacy_policy_version" varchar(32)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" DROP COLUMN IF EXISTS "privacy_policy_version", DROP COLUMN IF EXISTS "accepted_privacy_at"',
    );
  }
}
