import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdvisorDemoCompany1796200000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE advisor_demo_company (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      name varchar(120) NOT NULL,
      is_demo boolean NOT NULL DEFAULT true CHECK (is_demo)
    )`);
    await runner.query(`INSERT INTO advisor_demo_company (singleton, name, is_demo)
      VALUES (true, 'Empresa demo Jarvis', true)`);
  }

  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE advisor_demo_company');
  }
}
