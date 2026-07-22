import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveMappingValueFromSupplierConfigurations1742600000000
  implements MigrationInterface
{
  name = 'RemoveMappingValueFromSupplierConfigurations1742600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "supplier_configurations"`);
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN IF EXISTS "mapping_value"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN IF NOT EXISTS "mapping_value" jsonb
    `);
  }
}
