import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { User } from '../auth/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { HistorialFactura } from '../integration/entities/historial-factura.entity';
import { Integration } from '../integration/entities/integration.entity';
import { SiigoAccount } from '../integration/entities/siigo-account.entity';
import { SiigoPurchaseSyncJob } from '../integration/entities/siigo-purchase-sync-job.entity';
import { SupplierConfiguration } from '../integration/entities/supplier-configuration.entity';
import { SupplierItemAccountMapping } from '../integration/entities/supplier-item-account-mapping.entity';
import { JarvisTercero } from '../integration/jarvis/entities/jarvis-tercero.entity';
import { PurchaseInvoiceImportJob } from '../invoices/entities/purchase-invoice-import-job.entity';
import { PurchaseInvoiceImportJobRow } from '../invoices/entities/purchase-invoice-import-job-row.entity';
import { Plan } from '../plan/entities/plan.entity';
import { AppConfiguration } from './configuration';

export function buildTypeOrmConfig(
  configService: ConfigService<AppConfiguration, true>,
): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: configService.get('database.url', { infer: true }),
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
      User,
      UserCompany,
    ],
    migrations: ['dist/migrations/*.js'],
    migrationsRun: configService.get('database.migrationsRun', { infer: true }),
    synchronize: configService.get('database.synchronize', { infer: true }),
  };
}
