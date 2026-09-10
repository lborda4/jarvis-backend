import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema de productos nativos de Jarvis: categorías por empresa, productos
 * (con IVA y retenciones como columnas planas) y sus listas de precios en
 * tabla hija. Todo scopeado por company_id; los productos NO dependen de
 * ninguna integración externa.
 */
export class CreateProductsSchema1745800000000 implements MigrationInterface {
  name = 'CreateProductsSchema1745800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- product_categories ----
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        CONSTRAINT "PK_product_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_categories_company_name"
          UNIQUE ("company_id", "name"),
        CONSTRAINT "FK_product_categories_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    // ---- products ----
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "category_id" uuid,
        "sku" character varying(64) NOT NULL,
        "name" character varying(255) NOT NULL,
        "kind" character varying(20) NOT NULL,
        "unit" character varying(16) NOT NULL,
        "description" text,
        "apply_iva" boolean NOT NULL DEFAULT false,
        "tax_classification" character varying(20),
        "iva_rate" numeric(5,2),
        "price_includes_iva" boolean NOT NULL DEFAULT false,
        "retefuente_enabled" boolean NOT NULL DEFAULT false,
        "retefuente_concept" character varying(100),
        "retefuente_rate" numeric(5,2),
        "retefuente_min_base" numeric(14,2),
        "reteica_enabled" boolean NOT NULL DEFAULT false,
        "reteica_municipality" character varying(100),
        "reteica_rate" numeric(7,4),
        "reteica_min_base" numeric(14,2),
        "reteiva_enabled" boolean NOT NULL DEFAULT false,
        "reteiva_rate" numeric(5,2),
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_products_company_sku" UNIQUE ("company_id", "sku"),
        CONSTRAINT "FK_products_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_products_category"
          FOREIGN KEY ("category_id") REFERENCES "product_categories"("id")
          ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_company"
      ON "products" ("company_id")
    `);

    // ---- product_price_lists ----
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_price_lists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "product_id" uuid NOT NULL,
        "position" smallint NOT NULL,
        "name" character varying(255) NOT NULL,
        "price" numeric(14,2) NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_product_price_lists" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_price_lists_product_position"
          UNIQUE ("product_id", "position"),
        CONSTRAINT "FK_product_price_lists_product"
          FOREIGN KEY ("product_id") REFERENCES "products"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_price_lists_product"
      ON "product_price_lists" ("product_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_product_price_lists_product"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "product_price_lists"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_products_company"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_categories"`);
  }
}
