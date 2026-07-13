import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameItemsToPayloadInElectronicDocuments1740400000000
  implements MigrationInterface
{
  name = 'RenameItemsToPayloadInElectronicDocuments1740400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('electronic_documents');
    const hasItems = table?.columns.some((column) => column.name === 'items');
    const hasPayload = table?.columns.some(
      (column) => column.name === 'payload',
    );

    if (hasItems && !hasPayload) {
      await queryRunner.query(`
        ALTER TABLE "electronic_documents"
        RENAME COLUMN "items" TO "payload"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('electronic_documents');
    const hasPayload = table?.columns.some(
      (column) => column.name === 'payload',
    );
    const hasItems = table?.columns.some((column) => column.name === 'items');

    if (hasPayload && !hasItems) {
      await queryRunner.query(`
        ALTER TABLE "electronic_documents"
        RENAME COLUMN "payload" TO "items"
      `);
    }
  }
}
