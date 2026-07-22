import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { User } from '../auth/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { Integration } from '../integration/entities/integration.entity';
import { SiigoAccount } from '../integration/entities/siigo-account.entity';
import { SupplierConfiguration } from '../integration/entities/supplier-configuration.entity';
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
      SiigoAccount,
      ElectronicDocument,
      User,
      UserCompany,
    ],
    migrations: ['dist/migrations/*.js'],
    migrationsRun: configService.get('database.migrationsRun', { infer: true }),
    synchronize: configService.get('database.synchronize', { infer: true }),
  };
}
