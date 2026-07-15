import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProcessingMetadataToElectronicDocuments1741100000000
  implements MigrationInterface
{
  name = 'AddProcessingMetadataToElectronicDocuments1741100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "supplier_exists_in_siigo" boolean
    `);

    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "recommended_account" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "processing_status" character varying(50) NOT NULL DEFAULT 'PENDING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN "processing_status",
      DROP COLUMN "recommended_account",
      DROP COLUMN "supplier_exists_in_siigo"
    `);
  }
}
