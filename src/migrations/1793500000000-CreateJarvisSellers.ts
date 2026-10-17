import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateJarvisSellers1793500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE jarvis_sellers (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      name varchar(150) NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE UNIQUE INDEX UQ_jarvis_sellers_company_name ON jarvis_sellers(company_id,lower(name))');
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE jarvis_sellers'); }
}