-- Consultas de verificación de la revisión de 2026-11-14.
-- Ejecutar en la base que se desea revisar; no contiene credenciales.
-- Solo lectura. No ejecuta migraciones, triggers ni funciones de negocio.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '12s';
SET LOCAL lock_timeout = '1s';

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;

SELECT c.relname AS table_name,
       pg_total_relation_size(c.oid) AS total_bytes,
       pg_indexes_size(c.oid) AS index_bytes,
       s.n_live_tup AS estimated_live_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
ORDER BY pg_total_relation_size(c.oid) DESC;

SELECT c.relname AS table_name, co.conname, co.contype, co.convalidated,
       pg_get_constraintdef(co.oid) AS definition
FROM pg_constraint co
JOIN pg_class c ON c.oid = co.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
ORDER BY c.relname, co.conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- Restricciones/índices concretos definidos por migraciones.
-- Un NULL indica que ese nombre no existe; revisar también definiciones
-- equivalentes bajo otro nombre antes de decidir crear un índice.
SELECT 'UQ_user_companies_user_company' AS expected_name,
       to_regclass('public."UQ_user_companies_user_company"') AS existing_index
UNION ALL
SELECT 'UQ_jarvis_payment_methods_name',
       to_regclass('public."UQ_jarvis_payment_methods_name"')
UNION ALL
SELECT 'IDX_electronic_documents_company_provider',
       to_regclass('public.idx_electronic_documents_company_provider')
UNION ALL
SELECT 'IDX_supplier_configurations_company_integration',
       to_regclass('public."IDX_supplier_configurations_company_integration"');

-- Conteo de grupos repetidos, sin exponer identidades de proveedores.
SELECT count(*) AS duplicate_supplier_configuration_groups
FROM (
  SELECT 1 FROM supplier_configurations
  GROUP BY company_id, integration_id, supplier_document_type, supplier_document
  HAVING count(*) > 1
) duplicates;

SELECT count(*) AS duplicate_user_company_groups
FROM (
  SELECT 1 FROM user_companies
  GROUP BY user_id, company_id HAVING count(*) > 1
) duplicates;

SELECT count(*) AS duplicate_payment_method_name_groups
FROM (
  SELECT 1 FROM jarvis_payment_methods
  GROUP BY company_id, lower(btrim(name)) HAVING count(*) > 1
) duplicates;

SELECT count(*) AS import_rows_with_missing_document
FROM purchase_invoice_import_job_rows r
WHERE r.document_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM electronic_documents d WHERE d.id = r.document_id);

SELECT count(*) AS ai_logs_with_missing_document
FROM ai_generation_logs l
WHERE l.document_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM electronic_documents d WHERE d.id = l.document_id);

SELECT count(*) AS payroll_documents_with_different_employee_company
FROM jarvis_payroll_documents d
JOIN jarvis_payroll_employees e ON e.id = d.employee_id
WHERE d.company_id <> e.company_id;

SELECT count(*) AS product_taxes_with_different_company
FROM product_taxes pt
JOIN products p ON p.id = pt.product_id
JOIN jarvis_taxes t ON t.id = pt.tax_id
WHERE p.company_id <> t.company_id;

SELECT count(*) AS companies,
       count(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM jarvis_payroll_payment_methods p
           WHERE p.company_id = c.id AND p.system_key = 'cash'
         ) AND EXISTS (
           SELECT 1 FROM jarvis_payroll_payment_methods p
           WHERE p.company_id = c.id AND p.system_key = 'transfer'
         )
       ) AS companies_with_both_payroll_payment_methods
FROM companies c;

SELECT count(*) AS import_rows,
       count(*) FILTER (WHERE status IN ('pending', 'processing')) AS pending_or_processing,
       sum(pg_column_size(raw_row)) AS raw_row_stored_bytes
FROM purchase_invoice_import_job_rows;

SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND n.nspname = 'public';

SELECT name FROM migrations ORDER BY id;
ROLLBACK;
