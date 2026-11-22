import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNoteDocumentCredits1796100000000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE jarvis_note_document_credits (
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      note_key varchar(255) NOT NULL,
      status varchar(12) NOT NULL CHECK (status IN ('PROCESSING','APPLIED','FAILED','UNCERTAIN','SKIPPED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz,
      PRIMARY KEY(company_id, note_key)
    )`);
  }
  async down(runner: QueryRunner) {
    await runner.query('DROP TABLE jarvis_note_document_credits');
  }
}
