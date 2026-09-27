import { MigrationInterface, QueryRunner } from 'typeorm';
export class ConvertCompanyDescriptionToJson1790400000000 implements MigrationInterface {
  name = 'ConvertCompanyDescriptionToJson1790400000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "companies" ALTER COLUMN "description" TYPE jsonb
      USING CASE WHEN "description" IS NULL THEN NULL
        ELSE jsonb_build_object('description', "description", 'rules', '[]'::jsonb) END`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "companies" ALTER COLUMN "description" TYPE text USING "description"->>'description'`,
    );
  }
}
