import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Medio de pago histórico de facturas de compra (SIIGO `payments[]`):
 * `historial_facturas` guarda el dato crudo por factura (repetido en cada
 * línea, igual que el resto de columnas de esa tabla), y
 * `supplier_configurations` guarda el medio de pago dominante calculado en
 * el sync, para sugerirlo cuando `tiene_variabilidad=false`.
 */
export class AddMetodoPagoToPurchaseHistory1744100000000
  implements MigrationInterface
{
  name = 'AddMetodoPagoToPurchaseHistory1744100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "historial_facturas"
      ADD COLUMN IF NOT EXISTS "metodo_pago_id" integer,
      ADD COLUMN IF NOT EXISTS "metodo_pago_nombre" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "metodo_pago_default" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "metodo_pago_default"
    `);

    await queryRunner.query(`
      ALTER TABLE "historial_facturas"
      DROP COLUMN IF EXISTS "metodo_pago_id",
      DROP COLUMN IF EXISTS "metodo_pago_nombre"
    `);
  }
}
