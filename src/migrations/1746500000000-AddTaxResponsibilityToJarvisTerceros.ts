import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Tipo de responsabilidad" en la creación de terceros Jarvis — código de
 * la tabla maestra de NextPyme `type_liabilities` (ej. "R-99-PN", id 117),
 * que es el valor por defecto pedido explícitamente.
 */
export class AddTaxResponsibilityToJarvisTerceros1746500000000
  implements MigrationInterface
{
  name = 'AddTaxResponsibilityToJarvisTerceros1746500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "jarvis_terceros"
      ADD COLUMN IF NOT EXISTS "tax_responsibility" character varying(16)
        NOT NULL DEFAULT 'R-99-PN'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jarvis_terceros" DROP COLUMN IF EXISTS "tax_responsibility"`,
    );
  }
}
