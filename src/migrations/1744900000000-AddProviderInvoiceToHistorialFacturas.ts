import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Prefijo/número de la factura del TERCERO (SIIGO `provider_invoice`) y el
 * consecutivo numérico de SIIGO (`number`) — se capturan en el sync de
 * historial de compras para poder detectar, al importar un Excel de
 * Factura de compra, si esa factura del proveedor ya está creada en SIIGO
 * (evita duplicarla) sin tener que volver a consultar la API. Ver
 * findByProviderInvoices en HistorialFacturasRepository.
 */
export class AddProviderInvoiceToHistorialFacturas1744900000000
  implements MigrationInterface
{
  name = 'AddProviderInvoiceToHistorialFacturas1744900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "historial_facturas"
      ADD COLUMN IF NOT EXISTS "provider_invoice_prefix" character varying,
      ADD COLUMN IF NOT EXISTS "provider_invoice_number" character varying,
      ADD COLUMN IF NOT EXISTS "siigo_numero" integer
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_historial_facturas_provider_invoice"
      ON "historial_facturas" ("company_id", "integration_id", "provider_invoice_prefix", "provider_invoice_number")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_historial_facturas_provider_invoice"
    `);

    await queryRunner.query(`
      ALTER TABLE "historial_facturas"
      DROP COLUMN IF EXISTS "provider_invoice_prefix",
      DROP COLUMN IF EXISTS "provider_invoice_number",
      DROP COLUMN IF EXISTS "siigo_numero"
    `);
  }
}
