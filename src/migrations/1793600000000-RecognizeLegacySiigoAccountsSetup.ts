import { MigrationInterface, QueryRunner } from 'typeorm';

/** One-time compatibility repair for existing SIIGO customers.
 * The operator confirmed that their account catalogs were already uploaded.
 * Sending a document is not a prerequisite for having completed setup.
 * New integrations still require an actual Excel import in the setup service.
 */
export class RecognizeLegacySiigoAccountsSetup1793600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE integrations AS integration
      SET accounts_excel_imported_at = (
        SELECT MIN(account.created_at)
        FROM siigo_accounts AS account
        WHERE account.company_id = integration.company_id
          AND account.integration_id = integration.id
      )
      WHERE integration.provider = 'SIIGO'
        AND integration.accounts_excel_imported_at IS NULL
        AND EXISTS (
          SELECT 1 FROM siigo_accounts AS account
          WHERE account.company_id = integration.company_id
            AND account.integration_id = integration.id
        )
    `);
  }

  async down(): Promise<void> {
    // Data repair: clearing these marks could also clear subsequent real imports.
  }
}
