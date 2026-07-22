import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRecommendedAccountFromElectronicDocuments1742400000000
  implements MigrationInterface
{
  name = 'RemoveRecommendedAccountFromElectronicDocuments1742400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN IF EXISTS "recommended_account"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "recommended_account" jsonb
    `);
  }
}
