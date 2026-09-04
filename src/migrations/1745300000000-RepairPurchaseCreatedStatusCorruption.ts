import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repara documentos con un siigo_purchase_id real (prueba inequívoca de que
 * la factura SÍ existe en SIIGO) cuyo status quedó en algo distinto de
 * PURCHASE_CREATED — bug real reportado: una factura ya creada en SIIGO
 * (con consecutivo real) se mostraba como "Pendiente" con "Enviar"
 * habilitado, con riesgo de duplicarla en SIIGO si se reenviaba.
 *
 * La causa raíz (ver ElectronicDocumentService.createFromPurchaseInvoiceRows
 * y SiigoSupplierCreationService.completeSupplierCreation) era que los
 * documentos creados por match de provider_invoice nunca quedaban con
 * supplier_exists_in_siigo=true, así que si algo volvía a "preparar" el
 * documento (SiigoDocumentPreparationService), la creación/reutilización
 * automática del tercero pisaba el status con ACCOUNT_REQUIRED sin mirar
 * que el documento ya estaba PURCHASE_CREATED. Ambas causas ya están
 * corregidas en código — esta migración solo repara los datos que ya
 * quedaron mal antes del fix.
 */
export class RepairPurchaseCreatedStatusCorruption1745300000000
  implements MigrationInterface
{
  name = 'RepairPurchaseCreatedStatusCorruption1745300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "electronic_documents"
      SET "status" = 'PURCHASE_CREATED',
          "supplier_exists_in_siigo" = true
      WHERE "siigo_purchase_id" IS NOT NULL
        AND "status" <> 'PURCHASE_CREATED'
    `);
  }

  public async down(): Promise<void> {
    // Reparación de datos — no hay un estado "anterior" válido al que
    // volver (era justamente el corrupto), así que down() es un no-op.
  }
}
