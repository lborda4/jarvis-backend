import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddAdvisors1795800000000 implements MigrationInterface {
  name = 'AddAdvisors1795800000000';
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE advisors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
      commission_type varchar(10) NOT NULL DEFAULT 'FIXED' CHECK (commission_type IN ('FIXED','PERCENT')),
      commission_value numeric(14,2) NULL CHECK (commission_value IS NULL OR (commission_value >= 0 AND (commission_type <> 'PERCENT' OR commission_value <= 100))),
      registered_at timestamptz NULL, invitation_hash varchar(64) NULL, invitation_expires_at timestamptz NULL,
      last_delivery_status varchar(10) NULL CHECK (last_delivery_status IN ('SENT','FAILED')), last_invited_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await runner.query('CREATE UNIQUE INDEX advisors_invitation_hash_idx ON advisors(invitation_hash) WHERE invitation_hash IS NOT NULL');
    await runner.query('ALTER TABLE companies ADD COLUMN advisor_id uuid NULL REFERENCES advisors(id) ON DELETE RESTRICT');
    await runner.query('CREATE INDEX companies_advisor_id_idx ON companies(advisor_id) WHERE advisor_id IS NOT NULL');
  }
  async down(runner: QueryRunner) {
    await runner.query('ALTER TABLE companies DROP COLUMN advisor_id');
    await runner.query('DROP TABLE advisors');
    // Advisor users are retained to avoid deleting registered identities or reusing their email addresses.
  }
}
