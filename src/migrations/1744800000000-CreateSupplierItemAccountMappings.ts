import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mapeo de cuenta PUC a nivel (proveedor + descripción de ítem), separado
 * de supplier_configurations (que sigue siendo un registro por proveedor
 * para medio de pago/impuestos/tipo de ítem). Ver
 * SupplierItemAccountMapping — resuelve el falso positivo de "variabilidad"
 * cuando un proveedor factura varios conceptos, cada uno consistente en su
 * propia cuenta, pero distintos entre sí.
 */
export class CreateSupplierItemAccountMappings1744800000000 implements MigrationInterface {
  name = 'CreateSupplierItemAccountMappings1744800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "supplier_item_account_mappings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "integration_id" uuid NOT NULL REFERENCES "integrations"("id") ON DELETE CASCADE,
        "supplier_document_type" character varying NOT NULL DEFAULT 'NIT',
        "supplier_document" character varying NOT NULL,
        "description_normalized" text NOT NULL,
        "description_original" text NOT NULL,
        "account_code" character varying NOT NULL,
        "account_name" character varying,
        "confirmations_count" integer NOT NULL DEFAULT 0,
        "last_confirmed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_supplier_item_account_mappings_key"
      ON "supplier_item_account_mappings" (
        "company_id", "integration_id", "supplier_document_type",
        "supplier_document", "description_normalized"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_supplier_item_account_mappings_key"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "supplier_item_account_mappings"`,
    );
  }
}
