import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMetodoPagoTypeToHistorialFacturas1745600000000
  implements MigrationInterface
{
  name = 'AddMetodoPagoTypeToHistorialFacturas1745600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "historial_facturas"
      ADD COLUMN IF NOT EXISTS "metodo_pago_type" character varying,
      ADD COLUMN IF NOT EXISTS "metodo_pago_due_date" boolean
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "historial_facturas"
      DROP COLUMN IF EXISTS "metodo_pago_type",
      DROP COLUMN IF EXISTS "metodo_pago_due_date"
    `);
  }
}
