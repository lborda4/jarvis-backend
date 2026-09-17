import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza el bloque fijo de columnas de IVA/Retefuente/ReteICA/ReteIVA de
 * "products" por una relación real al catálogo de la empresa (jarvis_taxes,
 * ver Impuestos y retenciones) — pedido explícito: el producto ahora elige
 * impuestos/retenciones concretos del catálogo en vez de tarifas genéricas
 * fijas de la app.
 */
export class ReplaceProductTaxColumnsWithProductTaxes1746300000000
  implements MigrationInterface
{
  name = 'ReplaceProductTaxColumnsWithProductTaxes1746300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_taxes" (
        "product_id" uuid NOT NULL,
        "tax_id" uuid NOT NULL,
        CONSTRAINT "PK_product_taxes" PRIMARY KEY ("product_id", "tax_id"),
        CONSTRAINT "FK_product_taxes_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_product_taxes_tax"
          FOREIGN KEY ("tax_id") REFERENCES "jarvis_taxes"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_taxes_tax_id"
      ON "product_taxes" ("tax_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "products"
        DROP COLUMN IF EXISTS "apply_iva",
        DROP COLUMN IF EXISTS "tax_classification",
        DROP COLUMN IF EXISTS "iva_rate",
        DROP COLUMN IF EXISTS "price_includes_iva",
        DROP COLUMN IF EXISTS "retefuente_enabled",
        DROP COLUMN IF EXISTS "retefuente_concept",
        DROP COLUMN IF EXISTS "retefuente_rate",
        DROP COLUMN IF EXISTS "retefuente_min_base",
        DROP COLUMN IF EXISTS "reteica_enabled",
        DROP COLUMN IF EXISTS "reteica_municipality",
        DROP COLUMN IF EXISTS "reteica_rate",
        DROP COLUMN IF EXISTS "reteica_min_base",
        DROP COLUMN IF EXISTS "reteiva_enabled",
        DROP COLUMN IF EXISTS "reteiva_rate"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD COLUMN IF NOT EXISTS "apply_iva" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "tax_classification" character varying(20),
        ADD COLUMN IF NOT EXISTS "iva_rate" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "price_includes_iva" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "retefuente_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "retefuente_concept" character varying(100),
        ADD COLUMN IF NOT EXISTS "retefuente_rate" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "retefuente_min_base" numeric(14,2),
        ADD COLUMN IF NOT EXISTS "reteica_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "reteica_municipality" character varying(100),
        ADD COLUMN IF NOT EXISTS "reteica_rate" numeric(7,4),
        ADD COLUMN IF NOT EXISTS "reteica_min_base" numeric(14,2),
        ADD COLUMN IF NOT EXISTS "reteiva_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "reteiva_rate" numeric(5,2)
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_product_taxes_tax_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "product_taxes"`);
  }
}
