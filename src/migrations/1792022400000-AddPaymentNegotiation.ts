import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddPaymentNegotiation1792022400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE jarvis_payment_methods ADD COLUMN negotiation varchar(6)`);
    await runner.query(`UPDATE jarvis_payment_methods SET negotiation = CASE WHEN translate(lower(trim(name)), 'áéíóú', 'aeiou') ~ '^credito\\y|\\ycuentas? por (cobrar|pagar)\\y' THEN 'CREDIT' ELSE 'CASH' END`);
    await runner.query(`ALTER TABLE jarvis_payment_methods ALTER COLUMN negotiation SET DEFAULT 'CASH', ALTER COLUMN negotiation SET NOT NULL, ADD CONSTRAINT chk_payment_negotiation CHECK (negotiation IN ('CASH','CREDIT'))`);
  }
  async down(runner: QueryRunner): Promise<void> { await runner.query('ALTER TABLE jarvis_payment_methods DROP COLUMN negotiation'); }
}
