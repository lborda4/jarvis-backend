import { MigrationInterface, QueryRunner } from 'typeorm';

/** Inicializa el catálogo una sola vez, tanto para empresas actuales como nuevas. */
export class SeedGenericProducts1794500000000 implements MigrationInterface {
  name = 'SeedGenericProducts1794500000000';

  async up(runner: QueryRunner): Promise<void> {
    // La migración corre en una transacción. El bloqueo evita que una empresa
    // nazca entre la carga inicial y la instalación del trigger.
    await runner.query('LOCK TABLE companies IN SHARE ROW EXCLUSIVE MODE');
    await runner.query(`
      CREATE TABLE product_catalog_seeds (
        company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
        initialized_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await runner.query(`
      CREATE FUNCTION seed_generic_products_for_company(target_company_id uuid)
      RETURNS void LANGUAGE plpgsql AS $$
      DECLARE
        initialized integer;
        preset record;
        created_id uuid;
        candidate_sku text;
        suffix integer;
      BEGIN
        -- El marcador también serializa intentos simultáneos. No se restauran
        -- productos editados o eliminados por el usuario en consultas futuras.
        INSERT INTO product_catalog_seeds (company_id)
          VALUES (target_company_id) ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS initialized = ROW_COUNT;
        IF initialized = 0 THEN RETURN; END IF;

        FOR preset IN
          SELECT * FROM (VALUES
            ('product', 'PROD-GENERICO', 'producto generico'),
            ('service', 'SERV-GENERICO', 'servicio generico')
          ) AS defaults(kind, sku, name)
        LOOP
          -- Reconoce genéricos existentes, incluso con tildes, mayúsculas o
          -- espacios adicionales, y conserva sus precios y personalizaciones.
          IF EXISTS (
            SELECT 1 FROM products
            WHERE company_id = target_company_id AND kind = preset.kind
              AND regexp_replace(
                translate(lower(btrim(name)), 'áéíóúü', 'aeiouu'),
                '[[:space:]]+', ' ', 'g'
              ) = preset.name
          ) THEN CONTINUE; END IF;

          candidate_sku := preset.sku;
          suffix := 1;
          LOOP
            created_id := NULL;
            INSERT INTO products
              (company_id, sku, name, kind, unit, description, price_includes_iva)
              VALUES (target_company_id, candidate_sku, preset.name,
                preset.kind, '94', preset.name, false)
              ON CONFLICT (company_id, sku) DO NOTHING
              RETURNING id INTO created_id;
            EXIT WHEN created_id IS NOT NULL;
            -- Un SKU ocupado nunca reemplaza un producto del usuario ni
            -- consume consecutivos de la numeración automática PROD-/SERV-.
            suffix := suffix + 1;
            candidate_sku := preset.sku || '-' || suffix;
          END LOOP;

          -- El genérico no presupone un importe ni impuestos. El valor se
          -- completa al usarlo en un documento o editar su ficha de catálogo.
          INSERT INTO product_price_lists (product_id, position, name, price, enabled)
            VALUES (created_id, 1, 'Precio general', 0, true),
                   (created_id, 2, 'Precio 2', 0, false),
                   (created_id, 3, 'Precio 3', 0, false);
        END LOOP;
      END;
      $$
    `);
    await runner.query(`
      CREATE FUNCTION seed_company_generic_products_trigger()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM seed_generic_products_for_company(NEW.id);
        RETURN NEW;
      END;
      $$
    `);
    await runner.query(`
      CREATE TRIGGER seed_company_generic_products
      AFTER INSERT ON companies FOR EACH ROW
      EXECUTE FUNCTION seed_company_generic_products_trigger()
    `);
    await runner.query(`
      SELECT seed_generic_products_for_company(id) FROM companies ORDER BY id
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      'DROP TRIGGER IF EXISTS seed_company_generic_products ON companies',
    );
    await runner.query(
      'DROP FUNCTION IF EXISTS seed_company_generic_products_trigger()',
    );
    await runner.query(
      'DROP FUNCTION IF EXISTS seed_generic_products_for_company(uuid)',
    );
    await runner.query('DROP TABLE IF EXISTS product_catalog_seeds');
    // Los productos y precios se conservan: ya podrían estar en documentos
    // o haber sido personalizados desde que se aplicó la migración.
  }
}
