import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Source: Modelo_costos_punto_equilibrio_JENIUS_actualizado.xlsx, Productos. */
export class SeedJeniusCommissionCatalog1796000000000 implements MigrationInterface {
  name = 'SeedJeniusCommissionCatalog1796000000000';
  async up(runner: QueryRunner) {
    const plans = [
      ['jarvis_billing_initial_annual', 'BASIC', 139900], ['jarvis_billing_regular_annual', 'BASIC', 139900],
      ['jarvis_payroll_basic_annual', 'BASIC', 129900], ['jarvis_compliance_initial_annual', 'PRO', 230000],
      ['jarvis_compliance_unlimited_annual', 'PRO', 720000],
    ];
    for (const [code, tier, price] of plans) await runner.query(`UPDATE plans SET commission_class=$2, sale_price_cop=$3,
      commercial_terms=jsonb_set(commercial_terms, '{priceCop}', to_jsonb($3::numeric)), updated_at=now()
      WHERE code=$1 AND provider='JARVIS'`, [code, tier, price]);
    // Do not change subscription periods, capacities, saved top-up purchases, or historical sale amounts.
    await runner.query("ALTER TABLE advisor_sales ADD COLUMN commission_stage varchar(10) NOT NULL DEFAULT 'INITIAL' CHECK (commission_stage IN ('INITIAL','RENEWAL'))");
    await runner.query(`DO $$ DECLARE item record; BEGIN
      FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='advisor_sales'::regclass AND contype='c'
        AND pg_get_constraintdef(oid) LIKE '%commission_rate%'
      LOOP EXECUTE format('ALTER TABLE advisor_sales DROP CONSTRAINT %I', item.conname); END LOOP;
    END; $$`);
    await runner.query('ALTER TABLE advisor_sales ALTER COLUMN commission_rate TYPE numeric(5,2) USING commission_rate::numeric');
    await runner.query(`ALTER TABLE advisor_sales ADD CONSTRAINT advisor_sales_commission_rule CHECK (
      (commission_stage='INITIAL' AND ((commission_class='BASIC' AND commission_rate=10) OR (commission_class='PLUS' AND commission_rate=15) OR (commission_class='PRO' AND commission_rate=20))) OR
      (commission_stage='RENEWAL' AND kind='PLAN' AND ((commission_class='BASIC' AND commission_rate=5) OR (commission_class='PLUS' AND commission_rate=7.5) OR (commission_class='PRO' AND commission_rate=10)))
    )`);
  }
  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM advisor_sales WHERE commission_stage='RENEWAL') THEN
      RAISE EXCEPTION 'No se puede revertir mientras existan comisiones de renovación; se conserva el historial.'; END IF; END; $$`);
    await runner.query('ALTER TABLE advisor_sales DROP CONSTRAINT advisor_sales_commission_rule, DROP COLUMN commission_stage');
    await runner.query('ALTER TABLE advisor_sales ALTER COLUMN commission_rate TYPE integer USING commission_rate::integer');
    await runner.query("ALTER TABLE advisor_sales ADD CONSTRAINT advisor_sales_commission_rule CHECK ((commission_class='BASIC' AND commission_rate=10) OR (commission_class='PLUS' AND commission_rate=15) OR (commission_class='PRO' AND commission_rate=20))");
    // Keep catalog classifications: rolling back must not erase commercial configuration.
  }
}
