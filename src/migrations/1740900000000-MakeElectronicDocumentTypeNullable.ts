import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeElectronicDocumentTypeNullable1740900000000
  implements MigrationInterface
{
  name = 'MakeElectronicDocumentTypeNullable1740900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ALTER COLUMN "electronic_document_type" DROP DEFAULT
    `);

    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ALTER COLUMN "electronic_document_type" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "electronic_documents"
      SET "electronic_document_type" = 'PURCHASE_INVOICE'
      WHERE "electronic_document_type" IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ALTER COLUMN "electronic_document_type" SET DEFAULT 'PURCHASE_INVOICE'
    `);

    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ALTER COLUMN "electronic_document_type" SET NOT NULL
    `);
  }
}
