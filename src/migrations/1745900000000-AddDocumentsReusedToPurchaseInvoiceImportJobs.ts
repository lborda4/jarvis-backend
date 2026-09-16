import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cuántas filas de un import de Factura de compra terminaron REUSANDO un
 * ElectronicDocument que ya existía (mismo CUFE de un import anterior) en
 * vez de crear uno nuevo — hasta ahora ese conteo se calculaba en el worker
 * pero nunca se guardaba ni se le mostraba al usuario, así que un Excel con
 * muchas filas repetidas terminaba con un banner "Se importaron N documentos
 * correctamente" que no explicaba por qué N era mucho menor que el total del
 * Excel (bug real reportado: 46 filas, banner decía "7 documentos", sin
 * forma de saber si el resto falló o ya existía).
 */
export class AddDocumentsReusedToPurchaseInvoiceImportJobs1745900000000 implements MigrationInterface {
  name = 'AddDocumentsReusedToPurchaseInvoiceImportJobs1745900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "purchase_invoice_import_jobs" ADD COLUMN IF NOT EXISTS "documents_reused" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "purchase_invoice_import_jobs" DROP COLUMN IF EXISTS "documents_reused"`,
    );
  }
}
