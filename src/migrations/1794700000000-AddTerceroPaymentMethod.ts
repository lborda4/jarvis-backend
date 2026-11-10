import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTerceroPaymentMethod1794700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE jarvis_terceros ADD COLUMN payment_method_id integer NULL CHECK (payment_method_id > 0)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE jarvis_terceros DROP COLUMN payment_method_id',
    );
  }
}
