import { DataSource } from 'typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { User } from '../auth/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { HistorialFactura } from '../integration/entities/historial-factura.entity';
import { Integration } from '../integration/entities/integration.entity';
import { AiGenerationLog } from '../integration/openrouter/entities/ai-generation-log.entity';
import { SiigoAccount } from '../integration/entities/siigo-account.entity';
import { SiigoPurchaseSyncJob } from '../integration/entities/siigo-purchase-sync-job.entity';
import { SupplierConfiguration } from '../integration/entities/supplier-configuration.entity';
import { SupplierItemAccountMapping } from '../integration/entities/supplier-item-account-mapping.entity';
import { JarvisTercero } from '../integration/jarvis/entities/jarvis-tercero.entity';
import { PurchaseInvoiceImportJob } from '../invoices/entities/purchase-invoice-import-job.entity';
import { PurchaseInvoiceImportJobRow } from '../invoices/entities/purchase-invoice-import-job-row.entity';
import { Plan } from '../plan/entities/plan.entity';
import { Product } from '../products/entities/product.entity';
import { ProductCategory } from '../products/entities/product-category.entity';
import { ProductPriceList } from '../products/entities/product-price-list.entity';
import { loadEnvironmentVariables } from './env-file.util';

loadEnvironmentVariables();

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL no está definida. Configúrala en el archivo .env del entorno activo.',
  );
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  ssl: { rejectUnauthorized: false },
  entities: [
    Integration,
    Company,
    Plan,
    SupplierConfiguration,
    SupplierItemAccountMapping,
    SiigoAccount,
    HistorialFactura,
    SiigoPurchaseSyncJob,
    ElectronicDocument,
    JarvisTercero,
    PurchaseInvoiceImportJob,
    PurchaseInvoiceImportJobRow,
    AiGenerationLog,
    User,
    UserCompany,
    Product,
    ProductCategory,
    ProductPriceList,
  ],
  migrations: ['src/migrations/*.ts'],
});
