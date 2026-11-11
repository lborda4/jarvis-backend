import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddCompanyTrackingRenewals1794900000000 implements MigrationInterface {
  name = 'AddCompanyTrackingRenewals1794900000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "companies" ADD COLUMN "tracking_period_start" date, ADD COLUMN "tracking_last_paid_at" timestamptz');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "companies" DROP COLUMN "tracking_period_start", DROP COLUMN "tracking_last_paid_at"');
  }
}
