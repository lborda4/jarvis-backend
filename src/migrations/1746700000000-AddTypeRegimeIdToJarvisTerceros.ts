import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Tipo de régimen" en la creación de terceros Jarvis — id de la tabla
 * maestra de NextPyme `type_regime` (id 2 = No Responsable de IVA).
 */
export class AddTypeRegimeIdToJarvisTerceros1746700000000
  implements MigrationInterface
{
  name = 'AddTypeRegimeIdToJarvisTerceros1746700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      ADD COLUMN IF NOT EXISTS "type_regime_id" integer
        DEFAULT 2
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jarvis_terceros" DROP COLUMN IF EXISTS "type_regime_id"`,
    );
  }
}
