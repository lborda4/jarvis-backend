import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ciudad propia de la empresa (código DANE + nombre), elegida al crear la
 * empresa desde el panel admin. Se usa como default de ciudad al crear un
 * tercero en SIIGO cuando la factura importada no trae la del proveedor
 * (antes ese default era un Bogotá fijo sin relación con la empresa).
 */
export class AddCityToCompanies1744000000000 implements MigrationInterface {
  name = 'AddCityToCompanies1744000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "city_code" character varying,
      ADD COLUMN IF NOT EXISTS "city_name" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "city_code",
      DROP COLUMN IF EXISTS "city_name"
    `);
  }
}
