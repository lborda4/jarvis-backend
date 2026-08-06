import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterSiigoDocumentNumberToVarchar1743500000000
  implements MigrationInterface
{
  name = 'AlterSiigoDocumentNumberToVarchar1743500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ALTER COLUMN "siigo_document_number" TYPE varchar(64)
      USING CASE
        WHEN "siigo_document_number" IS NULL THEN NULL
        ELSE "siigo_document_number"::text
      END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ALTER COLUMN "siigo_document_number" TYPE integer
      USING CASE
        WHEN "siigo_document_number" ~ '^[0-9]+$'
          THEN "siigo_document_number"::integer
        WHEN "siigo_document_number" ~ '[0-9]+$'
          THEN (regexp_replace("siigo_document_number", '[^0-9]', '', 'g'))::integer
        ELSE NULL
      END
    `);
  }
}
