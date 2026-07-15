import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeMappingValueToJsonbInSupplierConfigurations1741000000000
  implements MigrationInterface
{
  name = 'ChangeMappingValueToJsonbInSupplierConfigurations1741000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('supplier_configurations');
    const mappingValueColumn = table?.columns.find(
      (column) => column.name === 'mapping_value',
    );

    if (mappingValueColumn?.type !== 'jsonb') {
      await queryRunner.query(`
        ALTER TABLE "supplier_configurations"
        ALTER COLUMN "mapping_value" TYPE jsonb
        USING (
          CASE
            WHEN "mapping_value" IS NULL OR btrim("mapping_value") = '' THEN NULL
            ELSE jsonb_build_object(
              'accounts',
              jsonb_build_array(
                jsonb_build_object(
                  'code', btrim("mapping_value"),
                  'name', btrim("mapping_value")
                )
              )
            )
          END
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "supplier_configurations"
      ALTER COLUMN "mapping_value" TYPE character varying
      USING (
        CASE
          WHEN "mapping_value" IS NULL THEN NULL
          ELSE COALESCE(
            "mapping_value"->'accounts'->0->>'code',
            "mapping_value"::text
          )
        END
      )
    `);
  }
}
