import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddPurchaseCostCenterHistory1791100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE historial_facturas ADD COLUMN centro_costo jsonb NULL');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE historial_facturas DROP COLUMN centro_costo');
  }
}
