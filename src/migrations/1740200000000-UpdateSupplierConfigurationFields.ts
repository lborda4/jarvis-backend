import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateSupplierConfigurationFields1740200000000
  implements MigrationInterface
{
  name = 'UpdateSupplierConfigurationFields1740200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ADD COLUMN "supplier_name" character varying
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ALTER COLUMN "mapping_value" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ALTER COLUMN "mapping_value" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      DROP COLUMN "supplier_name"
    `);
  }
}
