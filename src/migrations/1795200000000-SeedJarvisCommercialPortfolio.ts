import { MigrationInterface, QueryRunner } from 'typeorm';

/** Source: PORTAFOLIO INICIAL (1).xlsx, sheet Resumen. Top-ups are not plans. */
export class SeedJarvisCommercialPortfolio1795200000000 implements MigrationInterface {
  name = 'SeedJarvisCommercialPortfolio1795200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "plans" ADD COLUMN "commercial_terms" jsonb NULL');
    const plans = [
      { code: 'jarvis_billing_initial_annual', name: 'Inscripción inicial de facturación', priceCop: 139900, documents: 50, employees: null, modules: ['BILLING'] },
      { code: 'jarvis_billing_regular_annual', name: 'Inscripción regular de facturación', priceCop: 139900, documents: 25, employees: null, modules: ['BILLING'] },
      { code: 'jarvis_payroll_basic_annual', name: 'Nómina electrónica básica', priceCop: 129900, documents: null, employees: 2, modules: ['PAYROLL'] },
      { code: 'jarvis_compliance_initial_annual', name: 'Combo cumplimiento inicial', priceCop: 230000, documents: 50, employees: 2, modules: ['BILLING', 'PAYROLL'] },
      { code: 'jarvis_compliance_unlimited_annual', name: 'Combo cumplimiento ilimitado', priceCop: 720000, documents: null, employees: null, modules: ['BILLING', 'PAYROLL'] },
    ];
    for (const plan of plans) {
      await queryRunner.query(`
        INSERT INTO "plans" ("id", "name", "code", "provider", "document_limit", "included_document_types", "commercial_terms", "active")
        VALUES (gen_random_uuid(), $1, $2, 'JARVIS', $3, $4::jsonb, $5::jsonb, true)
        ON CONFLICT ("code") DO NOTHING
      `, [plan.name, plan.code, plan.documents, JSON.stringify(plan.modules.includes('BILLING') ? ['SUPPORT_DOCUMENT', 'PURCHASE_INVOICE'] : []), JSON.stringify({
        priceCop: plan.priceCop, billingMonths: 12, employeeLimit: plan.employees, modules: plan.modules,
        includesDigitalCertificate: true, includesRadian: plan.modules.includes('BILLING'),
      })]);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Preserve all existing subscriptions and legacy plans when rolling back.
    await queryRunner.query(`
      DELETE FROM "plans" WHERE "code" IN (
        'jarvis_billing_initial_annual', 'jarvis_billing_regular_annual', 'jarvis_payroll_basic_annual',
        'jarvis_compliance_initial_annual', 'jarvis_compliance_unlimited_annual'
      ) AND NOT EXISTS (SELECT 1 FROM "integrations" WHERE "plan_id" = "plans"."id")
    `);
    await queryRunner.query('ALTER TABLE "plans" DROP COLUMN "commercial_terms"');
  }
}
