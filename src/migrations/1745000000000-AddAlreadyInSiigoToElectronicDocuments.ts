import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Distingue, para documentos en PURCHASE_CREATED, si se crearon porque el
 * usuario los envió desde Jarvis (false) o porque ya existían en SIIGO al
 * importar el Excel — match por provider_invoice, ver
 * ElectronicDocumentService.createFromPurchaseInvoiceRows (true). Solo
 * cambia cómo se muestra el estado en el frontend ("Existente en SIIGO" vs
 * "Lista"); el resto de la lógica de negocio sigue tratando ambos casos
 * igual (no es un `status` aparte a propósito).
 */
export class AddAlreadyInSiigoToElectronicDocuments1745000000000
  implements MigrationInterface
{
  name = 'AddAlreadyInSiigoToElectronicDocuments1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "already_in_siigo" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN IF EXISTS "already_in_siigo"
    `);
  }
}
