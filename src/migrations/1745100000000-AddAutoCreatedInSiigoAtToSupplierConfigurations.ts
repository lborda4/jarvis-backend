import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca cuándo un tercero se creó AUTOMÁTICAMENTE en SIIGO (sin que el
 * usuario clickeara "Crear tercero"), ver
 * SiigoDocumentPreparationService.tryAutoCreateSupplier — se usa para
 * avisarle al usuario cuántos y cuáles terceros se crearon solos durante un
 * import (ver SupplierConfigurationsRepository.findAutoCreatedSince).
 */
export class AddAutoCreatedInSiigoAtToSupplierConfigurations1745100000000
  implements MigrationInterface
{
  name = 'AddAutoCreatedInSiigoAtToSupplierConfigurations1745100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "auto_created_in_siigo_at" timestamptz
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "auto_created_in_siigo_at"
    `);
  }
}
