import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJarvisInvoiceDrafts1793400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE jarvis_invoice_drafts (
      id uuid PRIMARY KEY,
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      document_kind varchar(30) NOT NULL,
      state jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE INDEX IDX_jarvis_invoice_drafts_company_kind ON jarvis_invoice_drafts(company_id,document_kind,updated_at DESC)');
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE jarvis_invoice_drafts');
  }
}