import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * processing_status quedó como campo duplicado de status: se escribía en
 * paralelo en cada punto de la preparación en segundo plano, pero nunca se
 * leyó para ninguna decisión real (ni backend ni frontend) más allá de un
 * único chequeo redundante en el frontend (isAccountPending), que ya
 * cubría lo mismo mirando `status`. El único valor que no tenía equivalente
 * en `status` (PROCESSING, "se está validando ahora mismo") tampoco lo leía
 * nadie. Ver auditoría completa antes de este cambio.
 */
export class DropProcessingStatusFromElectronicDocuments1744900000000 implements MigrationInterface {
  name = 'DropProcessingStatusFromElectronicDocuments1744900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      DROP COLUMN IF EXISTS "processing_status"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "electronic_documents"
      ADD COLUMN IF NOT EXISTS "processing_status" character varying(50) NOT NULL DEFAULT 'PENDING'
    `);
  }
}
