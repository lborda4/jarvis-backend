import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAiGenerationLogs1745700000000
  implements MigrationInterface
{
  name = 'CreateAiGenerationLogs1745700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_generation_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "ai_request_id" uuid NOT NULL,
        "company_id" uuid REFERENCES "companies"("id") ON DELETE SET NULL,
        "document_id" uuid REFERENCES "electronic_documents"("id") ON DELETE SET NULL,
        "purpose" character varying NOT NULL,
        "requested_model" character varying NOT NULL,
        "response_model" character varying,
        "open_router_generation_id" character varying,
        "open_router_request_id" character varying,
        "provider_name" character varying,
        "prompt_tokens" integer,
        "completion_tokens" integer,
        "reasoning_tokens" integer,
        "total_cost" numeric(12,6),
        "finish_reason" character varying,
        "native_finish_reason" character varying,
        "generation_time_ms" integer,
        "latency_ms" integer,
        "status" character varying NOT NULL DEFAULT 'pending',
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "completed_at" timestamptz
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ai_generation_logs_ai_request_id"
      ON "ai_generation_logs" ("ai_request_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_generation_logs_document"
      ON "ai_generation_logs" ("document_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_generation_logs_company"
      ON "ai_generation_logs" ("company_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_generation_logs_company"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_generation_logs_document"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ai_generation_logs_ai_request_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_generation_logs"`);
  }
}
