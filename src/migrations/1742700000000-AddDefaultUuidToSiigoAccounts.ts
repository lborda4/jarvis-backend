import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDefaultUuidToSiigoAccounts1742700000000
  implements MigrationInterface
{
  name = 'AddDefaultUuidToSiigoAccounts1742700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "siigo_accounts"
      ALTER COLUMN "id" SET DEFAULT gen_random_uuid()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "siigo_accounts"
      ALTER COLUMN "id" DROP DEFAULT
    `);
  }
}
