import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRadianSentAt1793300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "jarvis_radian_events" ADD COLUMN "sent_at" timestamptz NULL');
    await queryRunner.query(`UPDATE jarvis_radian_events AS event SET sent_at=COALESCE(
      (SELECT MIN((entry->>'recordedAt')::timestamptz)
       FROM jsonb_array_elements(event.history) AS entry
       WHERE entry->'result'->>'status'='sent'), event.updated_at)
      WHERE event.status='sent'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "jarvis_radian_events" DROP COLUMN "sent_at"');
  }
}
