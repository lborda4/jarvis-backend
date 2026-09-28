import { DataSource, DataSourceOptions } from 'typeorm';
import { buildTypeOrmConfig } from './typeorm.config';
import { SiigoBoldCashRegister } from '../bold/entities/siigo-bold-cash-register.entity';
import { Company } from '../company/entities/company.entity';

class MetadataDataSource extends DataSource {
  buildWithoutConnecting(): Promise<void> {
    return this.buildMetadatas();
  }
}

describe('application TypeORM metadata', () => {
  it('registers Bold cash registers and their company relation before accessing the repository', async () => {
    const config = {
      get: (key: string) => ({
        'database.url': 'postgres://test:test@localhost/test',
        'database.synchronize': false,
        'database.migrationsRun': false,
      })[key],
    };
    const source = new MetadataDataSource(buildTypeOrmConfig(config as never) as DataSourceOptions);
    await source.buildWithoutConnecting();
    const metadata = source.getRepository(SiigoBoldCashRegister).metadata;
    expect(metadata.tableName).toBe('siigo_bold_cash_register');
    expect(metadata.columns.find(column => column.propertyName === 'boldTerminalId')?.databaseName).toBe('bold_terminal_id');
    expect(metadata.relations.find(relation => relation.propertyName === 'company')?.inverseEntityMetadata.target).toBe(Company);
  });
});
