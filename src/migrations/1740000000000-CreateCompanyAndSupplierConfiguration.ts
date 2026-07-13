import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCompanyAndSupplierConfiguration1740000000000
  implements MigrationInterface
{
  name = 'CreateCompanyAndSupplierConfiguration1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid NOT NULL,
        "nit" character varying NOT NULL,
        "name" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_companies_nit" UNIQUE ("nit"),
        CONSTRAINT "PK_companies" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "supplier_configurations" (
        "id" uuid NOT NULL,
        "company_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "supplier_document" character varying NOT NULL,
        "item_type" character varying NOT NULL,
        "mapping_value" character varying NOT NULL,
        "auto_apply" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_configurations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_supplier_configurations_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_supplier_configurations_integration"
          FOREIGN KEY ("integration_id") REFERENCES "integrations"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_configurations_company_integration"
      ON "supplier_configurations" ("company_id", "integration_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_supplier_configurations_supplier_document"
      ON "supplier_configurations" ("supplier_document")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_supplier_configurations_supplier_document"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_supplier_configurations_company_integration"`,
    );
    await queryRunner.query(`DROP TABLE "supplier_configurations"`);
    await queryRunner.query(`DROP TABLE "companies"`);
  }
}
