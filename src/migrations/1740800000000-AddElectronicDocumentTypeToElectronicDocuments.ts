import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddElectronicDocumentTypeToElectronicDocuments1740800000000
  implements MigrationInterface
{
  name = 'AddElectronicDocumentTypeToElectronicDocuments1740800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN "electronic_document_type" character varying(50)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN "electronic_document_type"
    `);
  }
}
