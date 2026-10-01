import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIntegrationLogo1791300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "integrations" ADD COLUMN "logo" bytea NULL');
    await queryRunner.query('ALTER TABLE "integrations" ADD CONSTRAINT "CHK_integration_logo_size" CHECK (octet_length("logo") <= 512000)');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "integrations" DROP COLUMN "logo"');
  }
}
