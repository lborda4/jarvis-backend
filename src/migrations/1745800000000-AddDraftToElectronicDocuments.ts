import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Borrador de contabilización por documento: lo que el contador ajustó en el
 * panel de detalle y todavía no envió a SIIGO. Hasta ahora esos cambios solo
 * vivían en memoria del navegador y se perdían al recargar o cambiar de
 * sección.
 */
export class AddDraftToElectronicDocuments1745800000000
  implements MigrationInterface
{
  name = 'AddDraftToElectronicDocuments1745800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "electronic_documents" ADD COLUMN IF NOT EXISTS "draft" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "electronic_documents" DROP COLUMN IF EXISTS "draft"`,
    );
  }
}
