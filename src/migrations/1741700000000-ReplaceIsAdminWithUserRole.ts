import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceIsAdminWithUserRole1741700000000
  implements MigrationInterface
{
  name = 'ReplaceIsAdminWithUserRole1741700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "role" character varying(50) NOT NULL DEFAULT 'user'
    `);

    const hasIsAdminColumn = await queryRunner.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'is_admin'
      LIMIT 1
    `);

    if (hasIsAdminColumn.length > 0) {
      await queryRunner.query(`
        UPDATE "users"
        SET "role" = 'admin'
        WHERE "is_admin" = true
      `);

      await queryRunner.query(`
        ALTER TABLE "users"
        DROP COLUMN IF EXISTS "is_admin"
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "is_admin" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "users"
      SET "is_admin" = true
      WHERE "role" = 'admin'
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "role"
    `);
  }
}
