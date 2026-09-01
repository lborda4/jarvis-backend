import 'dotenv/config';
import dataSource from '../config/data-source';

/**
 * Puebla supplier_item_account_mappings desde el histórico ya sincronizado
 * en historial_facturas — no hace falta re-sincronizar nada de SIIGO, la
 * descripción de ítem ya se guarda por línea desde hace tiempo, solo nunca
 * se había usado para agrupar. Mismo umbral (70%) que
 * SiigoPurchaseHistorySyncService.isFieldFixed/VARIABILITY_THRESHOLD: si la
 * cuenta dominante de una (proveedor, descripción) cubre ≥70% de las líneas
 * de esa descripción puntual, se guarda como regla confirmada.
 *
 * Re-ejecutable sin duplicar (ON CONFLICT DO NOTHING sobre el índice único)
 * — no toca supplier_configurations/preference, que sigue siendo el
 * fallback exactamente igual que hoy.
 */
const VARIABILITY_THRESHOLD = 0.7;

async function backfillSupplierItemAccountMappings(): Promise<void> {
  await dataSource.initialize();

  const result = await dataSource.query<Array<{ id: string }>>(
    `
    WITH normalized AS (
      SELECT
        h.company_id,
        h.integration_id,
        h.proveedor_nit AS supplier_document,
        lower(regexp_replace(trim(h.descripcion_item), '\\s+', ' ', 'g')) AS description_normalized,
        h.descripcion_item AS description_original,
        h.cuenta_puc AS account_code
      FROM historial_facturas h
      WHERE h.proveedor_nit IS NOT NULL
        AND trim(h.descripcion_item) <> ''
        AND h.cuenta_puc IS NOT NULL
    ),
    grouped AS (
      SELECT
        company_id, integration_id, supplier_document, description_normalized,
        account_code,
        COUNT(*) AS cnt,
        (array_agg(description_original ORDER BY description_original))[1] AS description_original
      FROM normalized
      GROUP BY company_id, integration_id, supplier_document, description_normalized, account_code
    ),
    totals AS (
      SELECT company_id, integration_id, supplier_document, description_normalized, SUM(cnt) AS total
      FROM grouped
      GROUP BY company_id, integration_id, supplier_document, description_normalized
    ),
    ranked AS (
      SELECT
        g.*,
        t.total,
        ROW_NUMBER() OVER (
          PARTITION BY g.company_id, g.integration_id, g.supplier_document, g.description_normalized
          ORDER BY g.cnt DESC
        ) AS rn
      FROM grouped g
      JOIN totals t USING (company_id, integration_id, supplier_document, description_normalized)
    )
    INSERT INTO supplier_item_account_mappings (
      company_id, integration_id, supplier_document_type, supplier_document,
      description_normalized, description_original, account_code, account_name,
      confirmations_count, last_confirmed_at
    )
    SELECT
      r.company_id, r.integration_id, 'NIT', r.supplier_document,
      r.description_normalized, r.description_original, r.account_code,
      sa.name, r.cnt, now()
    FROM ranked r
    -- El nombre SIEMPRE sale del catálogo real de cuentas SIIGO, nunca del
    -- código — historial_facturas.cuenta_puc es solo un código, jamás
    -- guardarlo como si fuera el nombre (bug real: dejaba "71050511 -
    -- 71050511" en vez del nombre real de la cuenta en la UI).
    LEFT JOIN siigo_accounts sa
      ON sa.company_id = r.company_id
      AND sa.integration_id = r.integration_id
      AND sa.code = r.account_code
    WHERE r.rn = 1 AND r.cnt::float / r.total >= $1
    ON CONFLICT (company_id, integration_id, supplier_document_type, supplier_document, description_normalized)
    DO NOTHING
    RETURNING id
    `,
    [VARIABILITY_THRESHOLD],
  );

  console.log(
    `Backfill completo: ${result.length} regla(s) nueva(s) insertada(s) en supplier_item_account_mappings.`,
  );

  await dataSource.destroy();
}

backfillSupplierItemAccountMappings().catch((error) => {
  console.error(
    'Error en el backfill de supplier_item_account_mappings:',
    error,
  );
  process.exit(1);
});
