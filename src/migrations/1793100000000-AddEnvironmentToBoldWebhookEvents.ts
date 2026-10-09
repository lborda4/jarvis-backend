import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEnvironmentToBoldWebhookEvents1793100000000
  implements MigrationInterface
{
  name = 'AddEnvironmentToBoldWebhookEvents1793100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bold_webhook_events" ADD COLUMN IF NOT EXISTS "environment" varchar(16) NOT NULL DEFAULT 'production'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "bold_webhook_events" DROP COLUMN IF EXISTS "environment"',
    );
  }
}
