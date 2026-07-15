import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSupplierDocumentTypeToSupplierConfiguration1740500000000
  implements MigrationInterface
{
  name = 'AddSupplierDocumentTypeToSupplierConfiguration1740500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "supplier_document_type" character varying NOT NULL DEFAULT 'NIT'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_supplier_configurations_company_supplier_identity"
      ON "supplier_configurations" (
        "company_id",
        "integration_id",
        "supplier_document_type",
        "supplier_document"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_supplier_configurations_company_supplier_identity"`,
    );
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN "supplier_document_type"
    `);
  }
}
