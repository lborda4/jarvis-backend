import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisTaxCatalogSeeds1791000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS jarvis_tax_catalog_seeds (
      company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      initialized_at timestamptz NOT NULL DEFAULT now()
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS jarvis_tax_catalog_seeds');
  }
}
