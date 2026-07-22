import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTransactionalLeafSiigoAccounts1742900000000
  implements MigrationInterface
{
  name = 'BackfillTransactionalLeafSiigoAccounts1742900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "siigo_accounts" AS parent
      SET "is_transactional" = true
      WHERE parent."is_transactional" = false
        AND (
          parent."code" LIKE '5%'
          OR parent."code" LIKE '6%'
          OR parent."code" LIKE '7%'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "siigo_accounts" AS child
          WHERE child."company_id" = parent."company_id"
            AND child."integration_id" = parent."integration_id"
            AND child."code" <> parent."code"
            AND child."code" LIKE parent."code" || '%'
        )
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: cannot safely distinguish backfilled rows from manually imported ones.
  }
}
