import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisRadianEvents1792000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE jarvis_radian_events (
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      cufe varchar(96) NOT NULL, event_id smallint NOT NULL CHECK (event_id IN (1,2,3,4)),
      status varchar(12) NOT NULL CHECK (status IN ('processing','sent','failed','unknown')),
      attempt_id uuid NOT NULL, rejection_id integer NULL,
      cude text NULL, dian_code text NULL, message text NULL, response jsonb NULL,
      history jsonb NOT NULL DEFAULT '[]'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id,cufe,event_id)
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE jarvis_radian_events');
  }
}
