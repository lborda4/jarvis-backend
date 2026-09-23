import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Municipio del tercero Jarvis — id de la tabla maestra de NextPyme
 * `municipalities` (ej. 149 = Bogotá, D.C.).
 */
export class AddMunicipalityIdToJarvisTerceros1746600000000
  implements MigrationInterface
{
  name = 'AddMunicipalityIdToJarvisTerceros1746600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      ADD COLUMN IF NOT EXISTS "municipality_id" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jarvis_terceros" DROP COLUMN IF EXISTS "municipality_id"`,
    );
  }
}
