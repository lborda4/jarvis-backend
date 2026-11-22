import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCompanyCommercialTopUps1795300000000 implements MigrationInterface {
  name = 'AddCompanyCommercialTopUps1795300000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "integrations" ADD COLUMN "commercial_top_ups" jsonb NOT NULL DEFAULT '[]'::jsonb`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "integrations" DROP COLUMN "commercial_top_ups"');
  }
}
