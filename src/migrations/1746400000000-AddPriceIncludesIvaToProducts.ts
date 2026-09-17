import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "El precio incluye IVA": vuelve como un checkbox simple del producto (no
 * depende de qué impuestos/retenciones del catálogo se elijan) — se había
 * quitado junto con el resto de las columnas fijas de IVA/retenciones al
 * pasar a referenciar jarvis_taxes, pero el usuario lo pidió de vuelta.
 */
export class AddPriceIncludesIvaToProducts1746400000000
  implements MigrationInterface
{
  name = 'AddPriceIncludesIvaToProducts1746400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "price_includes_iva" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" DROP COLUMN IF EXISTS "price_includes_iva"`,
    );
  }
}
