import { MigrationInterface, QueryRunner } from 'typeorm';

export class ChangeResponsibleToJsonInCompanies1742100000000
  implements MigrationInterface
{
  name = 'ChangeResponsibleToJsonInCompanies1742100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "responsible" jsonb
    `);

    const columnInfo = await queryRunner.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'companies'
        AND column_name = 'responsible'
      LIMIT 1
    `);

    const dataType = columnInfo[0]?.data_type as string | undefined;

    if (dataType === 'character varying') {
      await queryRunner.query(`
        ALTER TABLE "companies"
        ALTER COLUMN "responsible" TYPE jsonb
        USING (
          CASE
            WHEN "responsible" IS NULL THEN NULL
            ELSE jsonb_build_object(
              'name', "responsible",
              'phone', '',
              'email', ''
            )
          END
        )
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ALTER COLUMN "responsible" TYPE character varying
      USING (
        CASE
          WHEN "responsible" IS NULL THEN NULL
          ELSE COALESCE("responsible"->>'name', '')
        END
      )
    `);
  }
}
