import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyJarvisModules1794200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" ADD COLUMN "jarvis_modules" jsonb NULL`);
    await queryRunner.query(`ALTER TABLE "companies" ADD CONSTRAINT "companies_jarvis_modules_check" CHECK (jarvis_modules IS NULL OR (jsonb_typeof(jarvis_modules) = 'array' AND jarvis_modules <@ '["BILLING","PAYROLL"]'::jsonb AND jsonb_array_length(jarvis_modules) > 0))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" DROP COLUMN "jarvis_modules"`);
  }
}
