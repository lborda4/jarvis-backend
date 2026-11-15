import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPayrollNoteNumbering1795100000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE jarvis_payroll_settings ADD COLUMN next_note_number bigint NOT NULL DEFAULT 1 CHECK(next_note_number>0)');
    await q.query(`UPDATE jarvis_payroll_settings s SET next_note_number=GREATEST(next_note_number,
      COALESCE((SELECT MAX(number) FROM jarvis_payroll_documents d WHERE d.company_id=s.company_id AND d.prefix='NA'),0)+1),
      settings=settings || '{"notePrefix":"NA"}'::jsonb`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('ALTER TABLE jarvis_payroll_settings DROP COLUMN next_note_number'); }
}
