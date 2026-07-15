import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersAndUserCompanies1741200000000
  implements MigrationInterface
{
  name = 'CreateUsersAndUserCompanies1741200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" uuid NOT NULL,
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_companies" (
        "id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "company_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_companies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_companies_user_company" UNIQUE ("user_id", "company_id"),
        CONSTRAINT "FK_user_companies_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_user_companies_company"
          FOREIGN KEY ("company_id") REFERENCES "companies"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_companies_user_id"
      ON "user_companies" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_companies_company_id"
      ON "user_companies" ("company_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_user_companies_company_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_user_companies_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_companies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
