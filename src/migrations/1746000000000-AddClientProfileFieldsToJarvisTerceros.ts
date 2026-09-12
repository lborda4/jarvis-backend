import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Campos del perfil del cliente que faltaban para el formulario de creación:
 * régimen fiscal, responsabilidad de IVA, actividad económica (CIIU), país y
 * código de municipio. Todos nullable para no romper los terceros existentes.
 */
export class AddClientProfileFieldsToJarvisTerceros1746000000000
  implements MigrationInterface
{
  name = 'AddClientProfileFieldsToJarvisTerceros1746000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      ADD COLUMN IF NOT EXISTS "fiscal_regime" character varying(32),
      ADD COLUMN IF NOT EXISTS "vat_regime" character varying(32),
      ADD COLUMN IF NOT EXISTS "economic_activity" character varying(255),
      ADD COLUMN IF NOT EXISTS "country" character varying(128),
      ADD COLUMN IF NOT EXISTS "city_code" character varying(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      DROP COLUMN IF EXISTS "city_code",
      DROP COLUMN IF EXISTS "country",
      DROP COLUMN IF EXISTS "economic_activity",
      DROP COLUMN IF EXISTS "vat_regime",
      DROP COLUMN IF EXISTS "fiscal_regime"
    `);
  }
}
