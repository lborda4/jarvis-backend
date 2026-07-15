import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDianCookieToCompany1740100000000 implements MigrationInterface {
  name = 'AddDianCookieToCompany1740100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      ADD COLUMN IF NOT EXISTS "dian_cookie" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "companies"
      DROP COLUMN "dian_cookie"
    `);
  }
}
