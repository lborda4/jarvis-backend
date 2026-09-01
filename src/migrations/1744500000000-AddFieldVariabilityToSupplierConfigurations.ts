import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reemplaza el modelo de variabilidad "todo o nada" (tiene_variabilidad +
 * cuenta_puc_default + impuestos_default + metodo_pago_default, todos
 * gateados por el mismo booleano calculado solo a partir de la cuenta
 * contable) por variabilidad calculada POR CAMPO: dos facturas del mismo
 * proveedor pueden diferir en medio de pago pero coincidir siempre en
 * cuenta contable, y antes eso apagaba TODAS las sugerencias (incluida la
 * de cuenta, que sí era confiable). `tiene_variabilidad` se conserva como
 * señal general de la cuenta contable (otros consumidores puntuales la
 * siguen usando), pero deja de ser el gate de las sugerencias.
 */
export class AddFieldVariabilityToSupplierConfigurations1744500000000
  implements MigrationInterface
{
  name = 'AddFieldVariabilityToSupplierConfigurations1744500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "campo_variabilidad" jsonb,
      DROP COLUMN IF EXISTS "cuenta_puc_default",
      DROP COLUMN IF EXISTS "impuestos_default",
      DROP COLUMN IF EXISTS "metodo_pago_default"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "cuenta_puc_default" character varying,
      ADD COLUMN IF NOT EXISTS "impuestos_default" jsonb,
      ADD COLUMN IF NOT EXISTS "metodo_pago_default" jsonb,
      DROP COLUMN IF EXISTS "campo_variabilidad"
    `);
  }
}
