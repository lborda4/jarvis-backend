import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { CreateProductsSchema1745800000000 } from '../migrations/1745800000000-CreateProductsSchema';
import { SeedGenericProducts1794500000000 } from '../migrations/1794500000000-SeedGenericProducts';

// Opt-in explícito. Todas las tablas, funciones y triggers se prueban en un
// esquema aislado dentro de una transacción que se revierte, nunca en public.
interface ProductRow {
  id: string;
  company_id: string;
  category_id: string | null;
  sku: string;
  name: string;
  kind: string;
  unit: string;
  description: string | null;
  price_includes_iva: boolean;
}
interface PriceRow {
  id: string;
  product_id: string;
  position: number;
  name: string;
  price: string;
  enabled: boolean;
}

const url = process.env.GENERIC_PRODUCTS_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration(
  'catálogo genérico para empresas actuales y nuevas en PostgreSQL',
  () => {
    let db: DataSource;
    let runner: QueryRunner;
    let schema: string;
    function query<T = ProductRow>(
      sql: string,
      parameters?: unknown[],
    ): Promise<T[]> {
      return db.query<T[]>(sql, parameters, runner);
    }
    const migration = new SeedGenericProducts1794500000000();
    const first = randomUUID();
    const second = randomUUID();

    beforeAll(async () => {
      db = new DataSource({
        type: 'postgres',
        url,
        ssl:
          process.env.GENERIC_PRODUCTS_TEST_SSL === '0'
            ? false
            : { rejectUnauthorized: false },
        connectTimeoutMS: 10000,
        synchronize: false,
        migrationsRun: false,
        logging: false,
      });
      await db.initialize();
    }, 30000);

    beforeEach(async () => {
      runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      schema = `generic_products_test_${randomUUID().replaceAll('-', '')}`;
      await query(`CREATE SCHEMA "${schema}"`);
      await query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
      await query(
        'CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text)',
      );
      await new CreateProductsSchema1745800000000().up(runner);
      await query(
        'INSERT INTO companies (id, name) VALUES ($1, $3), ($2, $3)',
        [first, second, 'Prueba'],
      );
    });

    afterEach(async () => {
      if (!db?.isInitialized) return;
      if (runner?.isTransactionActive) await runner.rollbackTransaction();
      await runner?.release();
      const [result] = await db.query<{ exists: boolean }[]>(
        'SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1) AS exists',
        [schema],
      );
      expect(result.exists).toBe(false);
    });

    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
    });

    it('crea dos genéricos propios por empresa con nombre, descripción y tres listas de precios', async () => {
      await migration.up(runner);
      const products = await query(
        'SELECT * FROM products ORDER BY company_id, kind',
      );
      expect(products).toHaveLength(4);
      for (const companyId of [first, second]) {
        const own = products.filter((p) => p.company_id === companyId);
        expect(
          own.map((p) => [p.kind, p.name, p.description, p.sku, p.unit]),
        ).toEqual([
          [
            'product',
            'producto generico',
            'producto generico',
            'PROD-GENERICO',
            '94',
          ],
          [
            'service',
            'servicio generico',
            'servicio generico',
            'SERV-GENERICO',
            '94',
          ],
        ]);
        for (const product of own) {
          expect(product.category_id).toBeNull();
          expect(product.price_includes_iva).toBe(false);
          const lists = await query<PriceRow>(
            'SELECT position, name, price, enabled FROM product_price_lists WHERE product_id=$1 ORDER BY position',
            [product.id],
          );
          expect(lists).toEqual([
            {
              position: 1,
              name: 'Precio general',
              price: '0.00',
              enabled: true,
            },
            { position: 2, name: 'Precio 2', price: '0.00', enabled: false },
            { position: 3, name: 'Precio 3', price: '0.00', enabled: false },
          ]);
        }
      }
      expect(new Set(products.map((p) => p.id)).size).toBe(4);
    });

    it('crea ambos genéricos dentro de la misma transacción al registrar nuevas empresas', async () => {
      await migration.up(runner);
      const ids = [randomUUID(), randomUUID()];
      await query('INSERT INTO companies (id) VALUES ($1), ($2)', ids);
      for (const id of ids) {
        const rows = await query(
          'SELECT name FROM products WHERE company_id=$1 ORDER BY kind',
          [id],
        );
        expect(rows.map((row) => row.name)).toEqual([
          'producto generico',
          'servicio generico',
        ]);
      }
    });

    it('reutiliza un genérico existente sin cambiar nombre, descripción ni precios', async () => {
      const [existing] = await query(
        `INSERT INTO products
      (company_id, sku, name, kind, unit, description)
      VALUES ($1,'PERSONALIZADO','  Producto   Genérico  ','product','94','Mi descripción') RETURNING id`,
        [first],
      );
      await query(
        `INSERT INTO product_price_lists (product_id, position, name, price, enabled) VALUES ($1,1,'Especial',12345,true)`,
        [existing.id],
      );
      await migration.up(runner);
      const rows = await query(
        'SELECT * FROM products WHERE company_id=$1 ORDER BY kind',
        [first],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: existing.id,
        name: '  Producto   Genérico  ',
        sku: 'PERSONALIZADO',
        description: 'Mi descripción',
      });
      expect(
        await query(
          'SELECT price, name FROM product_price_lists WHERE product_id=$1',
          [existing.id],
        ),
      ).toEqual([{ price: '12345.00', name: 'Especial' }]);
    });

    it('no confunde un servicio con un producto aunque tengan el mismo nombre', async () => {
      await query(
        `INSERT INTO products (company_id, sku, name, kind, unit)
      VALUES ($1,'OTRO','producto generico','service','94')`,
        [first],
      );
      await migration.up(runner);
      const rows = await query(
        'SELECT kind FROM products WHERE company_id=$1 AND name=$2 ORDER BY kind',
        [first, 'producto generico'],
      );
      expect(rows.map((p) => p.kind)).toEqual(['product', 'service']);
    });

    it('resuelve SKUs ocupados sin sobrescribir productos ni afectar otras empresas', async () => {
      await query(
        `INSERT INTO products (company_id, sku, name, kind, unit)
      VALUES ($1,'PROD-GENERICO','Camisa','product','94'),
             ($1,'PROD-GENERICO-2','Pantalón','product','94'),
             ($1,'SERV-GENERICO','Consultoría','service','94')`,
        [first],
      );
      await migration.up(runner);
      const own = await query(
        'SELECT sku, name FROM products WHERE company_id=$1 ORDER BY sku',
        [first],
      );
      expect(own).toEqual([
        { sku: 'PROD-GENERICO', name: 'Camisa' },
        { sku: 'PROD-GENERICO-2', name: 'Pantalón' },
        { sku: 'PROD-GENERICO-3', name: 'producto generico' },
        { sku: 'SERV-GENERICO', name: 'Consultoría' },
        { sku: 'SERV-GENERICO-2', name: 'servicio generico' },
      ]);
      expect(
        (
          await query(
            'SELECT sku FROM products WHERE company_id=$1 ORDER BY sku',
            [second],
          )
        ).map((p) => p.sku),
      ).toEqual(['PROD-GENERICO', 'SERV-GENERICO']);
    });

    it('es idempotente y conserva las ediciones y eliminaciones posteriores', async () => {
      await migration.up(runner);
      await query(
        `UPDATE products SET name='Mi producto', description='Personalizado' WHERE company_id=$1 AND kind='product'`,
        [first],
      );
      await query(
        `UPDATE product_price_lists SET price=5000 WHERE product_id IN (SELECT id FROM products WHERE company_id=$1 AND kind='product') AND position=1`,
        [first],
      );
      await query(
        `DELETE FROM products WHERE company_id=$1 AND kind='service'`,
        [first],
      );
      await query('SELECT seed_generic_products_for_company($1)', [first]);
      await query('SELECT seed_generic_products_for_company($1)', [first]);
      const rows = await query(
        'SELECT id, name, description FROM products WHERE company_id=$1',
        [first],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: 'Mi producto',
        description: 'Personalizado',
      });
      expect(
        (
          await query<{ price: string }>(
            'SELECT price FROM product_price_lists WHERE product_id=$1 AND position=1',
            [rows[0].id],
          )
        )[0].price,
      ).toBe('5000.00');
      expect(
        (
          await query<{ count: number }>(
            'SELECT count(*)::int AS count FROM product_catalog_seeds WHERE company_id=$1',
            [first],
          )
        )[0].count,
      ).toBe(1);
    });

    it('revierte también los genéricos si se revierte el registro de una empresa', async () => {
      await migration.up(runner);
      const id = randomUUID();
      await query('SAVEPOINT registration');
      await query('INSERT INTO companies (id) VALUES ($1)', [id]);
      expect(
        await query('SELECT id FROM products WHERE company_id=$1', [id]),
      ).toHaveLength(2);
      await query('ROLLBACK TO SAVEPOINT registration');
      expect(
        await query('SELECT id FROM companies WHERE id=$1', [id]),
      ).toHaveLength(0);
      expect(
        await query('SELECT id FROM products WHERE company_id=$1', [id]),
      ).toHaveLength(0);
      expect(
        await query(
          'SELECT company_id FROM product_catalog_seeds WHERE company_id=$1',
          [id],
        ),
      ).toHaveLength(0);
    });

    it('no deja una empresa ni un catálogo a medias si falla una de las inserciones', async () => {
      await migration.up(runner);
      await query(
        `ALTER TABLE products ADD CONSTRAINT reject_generic_service CHECK (name <> 'servicio generico') NOT VALID`,
      );
      const id = randomUUID();
      await query('SAVEPOINT failing_registration');
      await expect(
        query('INSERT INTO companies (id) VALUES ($1)', [id]),
      ).rejects.toThrow();
      await query('ROLLBACK TO SAVEPOINT failing_registration');
      expect(
        await query('SELECT id FROM companies WHERE id=$1', [id]),
      ).toHaveLength(0);
      expect(
        await query('SELECT id FROM products WHERE company_id=$1', [id]),
      ).toHaveLength(0);
      expect(
        await query(
          'SELECT company_id FROM product_catalog_seeds WHERE company_id=$1',
          [id],
        ),
      ).toHaveLength(0);
    });

    it('elimina por cascada los productos, precios y marcador al eliminar su empresa', async () => {
      await migration.up(runner);
      await query('DELETE FROM companies WHERE id=$1', [first]);
      expect(
        await query('SELECT id FROM products WHERE company_id=$1', [first]),
      ).toHaveLength(0);
      expect(
        await query(
          'SELECT company_id FROM product_catalog_seeds WHERE company_id=$1',
          [first],
        ),
      ).toHaveLength(0);
      expect(await query('SELECT id FROM product_price_lists')).toHaveLength(6);
      expect(
        await query('SELECT id FROM products WHERE company_id=$1', [second]),
      ).toHaveLength(2);
    });

    it('al revertir la migración conserva productos y precios que ya podrían estar en uso', async () => {
      await migration.up(runner);
      const products = await query('SELECT * FROM products ORDER BY id');
      const prices = await query<PriceRow>(
        'SELECT * FROM product_price_lists ORDER BY id',
      );
      await migration.down(runner);
      expect(await query('SELECT * FROM products ORDER BY id')).toEqual(
        products,
      );
      expect(
        await query<PriceRow>('SELECT * FROM product_price_lists ORDER BY id'),
      ).toEqual(prices);
      const id = randomUUID();
      await query('INSERT INTO companies (id) VALUES ($1)', [id]);
      expect(
        await query('SELECT id FROM products WHERE company_id=$1', [id]),
      ).toHaveLength(0);
      expect(
        (
          await query<{ table_name: string | null }>(
            'SELECT to_regclass($1) AS table_name',
            [`${schema}.product_catalog_seeds`],
          )
        )[0].table_name,
      ).toBeNull();
    });
  },
);
