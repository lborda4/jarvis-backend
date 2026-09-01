import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Esquema para clasificación de facturas de compra asistida por IA:
 * - supplier_configurations gana columnas de variabilidad/valores por defecto.
 * - historial_facturas guarda el historial de clasificación por línea de ítem
 *   (sincronizado desde SIIGO y/o confirmado por el contador al enviar).
 * - siigo_purchase_sync_jobs trackea el progreso del sync largo (paginado
 *   contra GET /v1/purchases) para que el botón "Sincronizar y continuar"
 *   pueda sobrevivir un refresh de página.
 */
export class CreatePurchaseHistorySchema1743800000000
  implements MigrationInterface
{
  name = 'CreatePurchaseHistorySchema1743800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "tiene_variabilidad" boolean
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "cuenta_puc_default" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "impuestos_default" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "ultima_actualizacion" TIMESTAMPTZ
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "historial_facturas" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "factura_id" character varying NOT NULL,
        "proveedor_nit" character varying NOT NULL,
        "descripcion_item" text NOT NULL,
        "tipo" character varying NOT NULL,
        "cuenta_puc" character varying NOT NULL,
        "impuestos" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "fuente" character varying NOT NULL,
        "fecha_factura" date NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_historial_facturas_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_historial_facturas_integration"
          FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_historial_facturas_proveedor"
      ON "historial_facturas" ("company_id", "integration_id", "proveedor_nit", "fecha_factura" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_historial_facturas_cuenta"
      ON "historial_facturas" ("company_id", "integration_id", "proveedor_nit", "cuenta_puc")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_historial_facturas_factura"
      ON "historial_facturas" ("company_id", "integration_id", "factura_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "siigo_purchase_sync_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL,
        "integration_id" uuid NOT NULL,
        "status" character varying NOT NULL DEFAULT 'running',
        "synced_count" integer NOT NULL DEFAULT 0,
        "total_count" integer,
        "error_message" text,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMPTZ,
        CONSTRAINT "FK_siigo_purchase_sync_jobs_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_siigo_purchase_sync_jobs_integration"
          FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_siigo_purchase_sync_jobs_company"
      ON "siigo_purchase_sync_jobs" ("company_id", "integration_id", "started_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_siigo_purchase_sync_jobs_company"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "siigo_purchase_sync_jobs"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_historial_facturas_factura"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_historial_facturas_cuenta"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_historial_facturas_proveedor"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "historial_facturas"`);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "ultima_actualizacion"
    `);
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "impuestos_default"
    `);
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "cuenta_puc_default"
    `);
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "tiene_variabilidad"
    `);
  }
}
