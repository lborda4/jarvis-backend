import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTerceroCopyEmails1794300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jarvis_terceros" ADD COLUMN "copy_emails" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    await queryRunner.query(`ALTER TABLE "jarvis_terceros" ADD CONSTRAINT "jarvis_terceros_copy_emails_check" CHECK (jsonb_typeof(copy_emails) = 'array' AND jsonb_array_length(copy_emails) <= 10)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jarvis_terceros" DROP COLUMN "copy_emails"`);
  }
}
