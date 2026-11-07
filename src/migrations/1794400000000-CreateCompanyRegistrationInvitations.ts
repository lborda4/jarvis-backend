import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateCompanyRegistrationInvitations1794400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE companies ADD COLUMN registration_email varchar(254) NULL`);
    await queryRunner.query(`CREATE TABLE company_registration_invitations (
      id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      email varchar(254) NOT NULL, token_hash char(64) NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL, used_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX company_registration_invitations_company_idx ON company_registration_invitations(company_id, created_at DESC)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE company_registration_invitations`);
    await queryRunner.query(`ALTER TABLE companies DROP COLUMN registration_email`);
  }
}
