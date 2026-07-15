import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSiigoDocumentNumberToElectronicDocuments1741400000000
  implements MigrationInterface
{
  name = 'AddSiigoDocumentNumberToElectronicDocuments1741400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "siigo_document_number" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN IF EXISTS "siigo_document_number"
    `);
  }
}
