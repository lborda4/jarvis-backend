import { DataSource } from 'typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { User } from '../auth/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { Integration } from '../integration/entities/integration.entity';
import { SupplierConfiguration } from '../integration/entities/supplier-configuration.entity';
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
    SupplierConfiguration,
    ElectronicDocument,
    User,
    UserCompany,
  ],
  migrations: ['src/migrations/*.ts'],
});
