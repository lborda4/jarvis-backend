import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { SHARED_DEMO_COMPANY_ID } from './shared-demo.constants';

@Injectable()
export class SharedDemoService {
  constructor(private readonly db: DataSource) {}

  async company() {
    const company = await this.db
      .getRepository(Company)
      .findOne({ where: { id: SHARED_DEMO_COMPANY_ID, isDemo: true } });
    if (!company)
      throw new ServiceUnavailableException(
        'La empresa demo compartida no está disponible. Aplica las migraciones pendientes.',
      );
    return company;
  }

  async grantAccess(userId: string) {
    const company = await this.company();
    // Serialize first access from multiple tabs without changing real memberships.
    await this.db.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `shared-demo-access:${userId}`,
      ]);
      await manager.query(
        `INSERT INTO user_companies (id, user_id, company_id)
        SELECT gen_random_uuid(),$1::uuid,$2::uuid WHERE EXISTS (SELECT 1 FROM users WHERE id=$1 AND active=true AND role='advisor')
          AND NOT EXISTS (SELECT 1 FROM user_companies WHERE user_id=$1 AND company_id=$2)
        ON CONFLICT (user_id,company_id) DO NOTHING`,
        [userId, company.id],
      );
    });
    return {
      id: company.id,
      name: company.name,
      nit: company.nit,
      isDemo: true,
      jarvisModules: company.jarvisModules,
    };
  }
}
