import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Texto libre de a qué se dedica la empresa. Lo escribe el admin al crear
 * o editar, y se manda en los prompts de clasificación de facturas de
 * compra para que la IA sepa el rubro (inventario vs gasto, cuenta PUC).
 */
export class AddDescriptionToCompanies1746200000000
  implements MigrationInterface
{
  name = 'AddDescriptionToCompanies1746200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "description" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "description"
    `);
  }
}
