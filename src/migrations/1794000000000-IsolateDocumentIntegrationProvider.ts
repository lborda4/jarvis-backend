import { MigrationInterface, QueryRunner } from 'typeorm';

export class IsolateDocumentIntegrationProvider1794000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE electronic_documents ADD COLUMN provider varchar(50)`);
    await queryRunner.query(`ALTER TABLE purchase_invoice_import_jobs ADD COLUMN provider varchar(50)`);
    // Historical records can only be assigned automatically when unambiguous.
    for (const table of ['electronic_documents', 'purchase_invoice_import_jobs']) {
      await queryRunner.query(`UPDATE ${table} d SET provider = source.provider FROM (
        SELECT company_id, min(provider) AS provider FROM integrations
        WHERE active = true AND provider IN ('SIIGO', 'JARVIS')
        GROUP BY company_id HAVING count(*) = 1
      ) source WHERE source.company_id = d.company_id`);
    }
    await queryRunner.query(`CREATE INDEX IDX_electronic_documents_company_provider ON electronic_documents (company_id, provider)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IDX_electronic_documents_company_provider`);
    await queryRunner.query(`ALTER TABLE purchase_invoice_import_jobs DROP COLUMN provider`);
    await queryRunner.query(`ALTER TABLE electronic_documents DROP COLUMN provider`);
  }
}
