import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices para los filtros/búsqueda de electronic_documents
 * (ElectronicDocumentsRepository.findAll / findFilterOptions), que hasta
 * ahora sólo tenían índice en company_id y cufe (exacto) — el resto de
 * columnas usadas en WHERE/IN/ORDER BY y la búsqueda ILIKE %term% sobre
 * campos del JSONB `payload` hacían table scan.
 *
 * Nota: en una tabla ya grande en producción, conviene correr estos
 * CREATE INDEX con CONCURRENTLY a mano en vez de vía migración (no se
 * puede combinar CONCURRENTLY con una transacción).
 */
export class AddElectronicDocumentsSearchIndexes1743700000000
  implements MigrationInterface
{
  name = 'AddElectronicDocumentsSearchIndexes1743700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Filtros por igualdad/IN usados en cada listado.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_company_type"
      ON "electronic_documents" ("company_id", "electronic_document_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_status"
      ON "electronic_documents" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_document_number_third"
      ON "electronic_documents" ("document_number_third")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_siigo_document_number"
      ON "electronic_documents" ("siigo_document_number")
    `);

    // payload->invoice->issueDate: igualdad/IN/ORDER BY/DISTINCT.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_issue_date"
      ON "electronic_documents" ((payload -> 'invoice' ->> 'issueDate'))
    `);

    // Búsqueda ILIKE '%term%' del filtro "search": necesita trigramas, un
    // índice btree normal no sirve para un patrón con comodín al inicio.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_cufe_trgm"
      ON "electronic_documents" USING GIN ("cufe" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_document_number_third_trgm"
      ON "electronic_documents" USING GIN ("document_number_third" gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_invoice_number_trgm"
      ON "electronic_documents"
      USING GIN ((payload -> 'invoice' ->> 'number') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_supplier_name_trgm"
      ON "electronic_documents"
      USING GIN ((payload -> 'supplier' ->> 'name') gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_electronic_documents_supplier_document_trgm"
      ON "electronic_documents"
      USING GIN ((payload -> 'supplier' ->> 'documentNumber') gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_supplier_document_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_supplier_name_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_invoice_number_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_document_number_third_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_cufe_trgm"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_issue_date"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_siigo_document_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_document_number_third"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_electronic_documents_company_type"`,
    );
  }
}
