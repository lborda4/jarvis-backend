import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Token propio de NextPyme por empresa, usado por la consulta de factura de
 * compra por CUFE al importar Excel (antes solo existía un token global vía
 * NEXTPYME_API_TOKEN). Nullable: sin valor, se sigue usando el global.
 */
export class AddNextPymeTokenToCompanies1743900000000
  implements MigrationInterface
{
  name = 'AddNextPymeTokenToCompanies1743900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "next_pyme_token" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN IF EXISTS "next_pyme_token"
    `);
  }
}
