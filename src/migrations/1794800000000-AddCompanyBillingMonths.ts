import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddCompanyBillingMonths1794800000000 implements MigrationInterface {
  name = 'AddCompanyBillingMonths1794800000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "companies" ADD COLUMN "billing_months" integer');
    await queryRunner.query(`UPDATE "companies" SET "billing_months" = CASE "billing_cycle" WHEN 'MONTHLY' THEN 1 WHEN 'ANNUAL' THEN 12 ELSE NULL END`);
    await queryRunner.query('ALTER TABLE "companies" ADD CONSTRAINT "CHK_companies_billing_months" CHECK ("billing_months" IS NULL OR "billing_months" BETWEEN 1 AND 1200)');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "companies" DROP CONSTRAINT "CHK_companies_billing_months", DROP COLUMN "billing_months"');
  }
}
