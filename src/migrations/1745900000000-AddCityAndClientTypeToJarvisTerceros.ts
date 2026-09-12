import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agrega ciudad (nombre) y tipo de cliente (client/supplier) a los terceros.
 * La ciudad se autocompleta desde el lookup DIAN de NextPyme; el tipo de
 * cliente lo elige el usuario al crear el tercero. Ambas nullable para no
 * romper los terceros ya existentes.
 */
export class AddCityAndClientTypeToJarvisTerceros1745900000000
  implements MigrationInterface
{
  name = 'AddCityAndClientTypeToJarvisTerceros1745900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      ADD COLUMN IF NOT EXISTS "city" character varying(255),
      ADD COLUMN IF NOT EXISTS "client_type" character varying(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      DROP COLUMN IF EXISTS "client_type",
      DROP COLUMN IF EXISTS "city"
    `);
  }
}
