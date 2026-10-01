import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddCompanyTracking1791800000000 implements MigrationInterface {
  name = 'AddCompanyTracking1791800000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "commercial" varchar(120), ADD COLUMN IF NOT EXISTS "billing_cycle" varchar(10)');
    await queryRunner.query(`ALTER TABLE "companies" ADD CONSTRAINT "CHK_companies_billing_cycle" CHECK ("billing_cycle" IS NULL OR "billing_cycle" IN ('MONTHLY', 'ANNUAL'))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "companies" DROP CONSTRAINT "CHK_companies_billing_cycle", DROP COLUMN "billing_cycle", DROP COLUMN "commercial"');
  }
}
