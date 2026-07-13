import 'dotenv/config';
import { DataSource } from 'typeorm';
import { UserCompany } from '../auth/entities/user-company.entity';
import { User } from '../auth/entities/user.entity';
import { Company } from '../company/entities/company.entity';
import { ElectronicDocument } from '../electronic-document/entities/electronic-document.entity';
import { Integration } from '../integration/entities/integration.entity';
import { SupplierConfiguration } from '../integration/entities/supplier-configuration.entity';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
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
