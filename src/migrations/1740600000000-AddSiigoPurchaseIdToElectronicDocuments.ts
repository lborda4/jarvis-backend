import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSiigoPurchaseIdToElectronicDocuments1740600000000
  implements MigrationInterface
{
  name = 'AddSiigoPurchaseIdToElectronicDocuments1740600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "siigo_purchase_id" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN "siigo_purchase_id"
    `);
  }
}
