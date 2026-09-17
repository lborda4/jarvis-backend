import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropIsValueBasedFromJarvisTaxes1746200000000
  implements MigrationInterface
{
  name = 'DropIsValueBasedFromJarvisTaxes1746200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jarvis_taxes" DROP COLUMN IF EXISTS "is_value_based"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "jarvis_taxes" ADD COLUMN IF NOT EXISTS "is_value_based" boolean NOT NULL DEFAULT false`,
    );
  }
}
