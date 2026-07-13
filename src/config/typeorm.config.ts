import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { User } from '../auth/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { Integration } from '../integration/entities/integration.entity';
import { SupplierConfiguration } from '../integration/entities/supplier-configuration.entity';

export function getTypeOrmConfig(): TypeOrmModuleOptions {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL no está definida. Configúrala en tu archivo .env',
    );
  }

  return {
    type: 'postgres',
    url: databaseUrl,
    ssl: { rejectUnauthorized: false },
    entities: [
      Integration,
      Company,
      SupplierConfiguration,
      ElectronicDocument,
      User,
      UserCompany,
    ],
    migrations: ['dist/migrations/*.js'],
    migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
  };
}
