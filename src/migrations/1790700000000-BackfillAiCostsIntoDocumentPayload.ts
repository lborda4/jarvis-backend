import { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillAiCostsIntoDocumentPayload1790700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // Conserva el historial y da prioridad a costos ya guardados en el payload.
    await queryRunner.query(`
      WITH historical AS (
        SELECT document_id, company_id,
          jsonb_object_agg(ai_request_id::text, total_cost) AS costs
        FROM ai_generation_logs
        WHERE document_id IS NOT NULL AND company_id IS NOT NULL
          AND total_cost IS NOT NULL AND total_cost >= 0
          AND total_cost::text NOT IN ('NaN', 'Infinity', '-Infinity')
        GROUP BY document_id, company_id
      )
      UPDATE electronic_documents AS document
      SET payload = jsonb_set(document.payload, '{aiSuggestion}',
        COALESCE(NULLIF(document.payload->'aiSuggestion', 'null'::jsonb), '{}'::jsonb)
        || jsonb_build_object(
          'currency', 'USD',
          'costsByRequest', historical.costs || COALESCE(
            NULLIF(document.payload#>'{aiSuggestion,costsByRequest}', 'null'::jsonb), '{}'::jsonb),
          'totalCost', (
            SELECT SUM(value::numeric)
            FROM jsonb_each_text(historical.costs || COALESCE(
              NULLIF(document.payload#>'{aiSuggestion,costsByRequest}', 'null'::jsonb), '{}'::jsonb))
          ),
          'retentions', COALESCE(NULLIF(document.payload#>'{aiSuggestion,retentions}', 'null'::jsonb), '[]'::jsonb)
        ))
      FROM historical
      WHERE document.id = historical.document_id
        AND document.company_id = historical.company_id
    `);
  }

  async down(): Promise<void> {
    // No borrar costos de peticiones nuevas al revertir una migración de datos.
  }
}
