import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateIntegrationPolicyAcceptances1791936000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE integration_policy_acceptances (
      user_id uuid NOT NULL REFERENCES users(id),
      company_id uuid NOT NULL REFERENCES companies(id),
      policy_id text NOT NULL, version text NOT NULL, policy_text text NOT NULL,
      policy_hash text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, company_id, policy_id)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE integration_policy_acceptances'); }
}
