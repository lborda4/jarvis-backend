import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * findDominantPaymentMethodByCuenta filtra por (company_id, integration_id,
 * cuenta_puc) SIN proveedor_nit — el índice existente
 * IDX_historial_facturas_cuenta no sirve para esa consulta porque
 * proveedor_nit va ANTES de cuenta_puc en ese compuesto, así que Postgres
 * caía a un escaneo secuencial de toda la empresa. Se llama en un for por
 * cada documento sin medio de pago sugerido al listar Factura de compra, así
 * que sin este índice se sentía en cada filtro (ver
 * ElectronicDocumentService.buildSupplierPreferencesLookup).
 */
export class AddCuentaDirectaIndexToHistorialFacturas1745200000000
  implements MigrationInterface
{
  name = 'AddCuentaDirectaIndexToHistorialFacturas1745200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_historial_facturas_cuenta_directa"
      ON "historial_facturas" ("company_id", "integration_id", "cuenta_puc")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_historial_facturas_cuenta_directa"
    `);
  }
}
