import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateElectronicDocuments1740300000000
  implements MigrationInterface
{
  name = 'CreateElectronicDocuments1740300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "electronic_documents" (
        "id" uuid NOT NULL,
        "company_id" uuid NOT NULL,
        "cufe" character varying,
        "document_number_third" character varying,
        "document_type_third" character varying,
        "status" character varying(50) NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_electronic_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_electronic_documents_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_electronic_documents_company_id"
      ON "electronic_documents" ("company_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_electronic_documents_cufe"
      ON "electronic_documents" ("cufe")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_electronic_documents_cufe"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_electronic_documents_company_id"`,
    );
    await queryRunner.query(`DROP TABLE "electronic_documents"`);
  }
}
