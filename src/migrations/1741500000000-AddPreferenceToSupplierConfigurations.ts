import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreferenceToSupplierConfigurations1741500000000
  implements MigrationInterface
{
  name = 'AddPreferenceToSupplierConfigurations1741500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "preference" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "preference"
    `);
  }
}
