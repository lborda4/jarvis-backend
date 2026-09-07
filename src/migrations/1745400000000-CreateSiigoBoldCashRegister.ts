import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Relaciona una caja/sucursal de SIIGO POS con el terminal de Bold que debe
 * recibir el cobro — ver SiigoBoldCashRegister. Una fila por caja física;
 * el índice único evita mapear la misma caja dos veces para la misma
 * empresa.
 */
export class CreateSiigoBoldCashRegister1745400000000
  implements MigrationInterface
{
  name = 'CreateSiigoBoldCashRegister1745400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "siigo_bold_cash_register" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
        "branch_office_id" integer NOT NULL,
        "cash_register_id" character varying NOT NULL,
        "cash_register_name" character varying NOT NULL,
        "bold_terminal_id" character varying NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_siigo_bold_cash_register_key"
      ON "siigo_bold_cash_register" (
        "company_id", "branch_office_id", "cash_register_id"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_siigo_bold_cash_register_key"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "siigo_bold_cash_register"`,
    );
  }
}
