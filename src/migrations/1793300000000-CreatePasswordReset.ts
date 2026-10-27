import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePasswordReset1793300000000 implements MigrationInterface {
  name = 'CreatePasswordReset1793300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "used_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_password_reset_tokens_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_password_reset_tokens_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_password_reset_tokens_user_id"
      ON "password_reset_tokens" ("user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "password_reset_attempts" (
        "id" uuid NOT NULL,
        "key_hash" character varying(64) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_password_reset_attempts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_password_reset_attempts_key_created"
      ON "password_reset_attempts" ("key_hash", "created_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_password_reset_attempts_key_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "password_reset_attempts"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_password_reset_tokens_user_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "password_reset_tokens"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "password_changed_at"`,
    );
  }
}
