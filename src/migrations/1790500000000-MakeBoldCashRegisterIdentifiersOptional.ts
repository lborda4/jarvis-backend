import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeBoldCashRegisterIdentifiersOptional1790500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "siigo_bold_cash_register" ALTER COLUMN "branch_office_id" DROP NOT NULL, ALTER COLUMN "cash_register_id" DROP NOT NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // No inventar identificadores ni eliminar cajas al revertir.
    await queryRunner.query(
      'ALTER TABLE "siigo_bold_cash_register" ALTER COLUMN "branch_office_id" SET NOT NULL, ALTER COLUMN "cash_register_id" SET NOT NULL',
    );
  }
}
