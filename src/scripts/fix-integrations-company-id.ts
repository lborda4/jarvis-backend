import 'dotenv/config';
import dataSource from '../config/data-source';

async function fixIntegrationsCompanyId(): Promise<void> {
  await dataSource.initialize();

  const sql = `
    ALTER TABLE "integrations"
    ADD COLUMN IF NOT EXISTS "company_id" uuid;

    UPDATE "integrations" i
    SET "company_id" = (
      SELECT c.id FROM "companies" c ORDER BY c.created_at ASC LIMIT 1
    )
    WHERE i."company_id" IS NULL
      AND EXISTS (SELECT 1 FROM "companies" c);

    DELETE FROM "integrations"
    WHERE "company_id" IS NULL;

    ALTER TABLE "integrations"
    ALTER COLUMN "company_id" SET NOT NULL;

    ALTER TABLE "integrations"
    DROP CONSTRAINT IF EXISTS "UQ_integrations_provider";

    ALTER TABLE "integrations"
    DROP CONSTRAINT IF EXISTS "integrations_provider_key";

    DO $$
    BEGIN
      ALTER TABLE "integrations"
      ADD CONSTRAINT "FK_integrations_company"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS "UQ_integrations_company_provider"
    ON "integrations" ("company_id", "provider");
  `;

  await dataSource.query(sql);

  const integrations = await dataSource.query(
    'SELECT id, company_id, provider FROM integrations ORDER BY created_at',
  );
  const companies = await dataSource.query(
    'SELECT id, name, nit FROM companies ORDER BY created_at',
  );

  console.log('Reparación aplicada correctamente.');
  console.log('Companies:', companies);
  console.log('Integrations:', integrations);

  await dataSource.destroy();
}

fixIntegrationsCompanyId().catch((error) => {
  console.error('Error al reparar integrations.company_id:', error);
  process.exit(1);
});
