import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBoldWebhookEvents1793000000000 implements MigrationInterface {
  name = 'CreateBoldWebhookEvents1793000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "bold_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "notification_id" character varying NOT NULL,
        "company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL,
        "type" character varying NOT NULL,
        "payment_id" character varying,
        "reference" character varying,
        "merchant_id" character varying,
        "amount_total" numeric(20,2),
        "amount_currency" character varying(10),
        "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_bold_webhook_events_notification" ON "bold_webhook_events" ("notification_id")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_bold_webhook_events_payment" ON "bold_webhook_events" ("company_id", "payment_id")',
    );
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_bold_webhook_events_reference" ON "bold_webhook_events" ("company_id", "reference")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_bold_webhook_events_reference"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_bold_webhook_events_payment"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_bold_webhook_events_notification"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "bold_webhook_events"');
  }
}
