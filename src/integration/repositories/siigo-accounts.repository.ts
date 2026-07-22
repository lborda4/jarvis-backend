import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { SiigoAccount } from '../entities/siigo-account.entity';

@Injectable()
export class SiigoAccountsRepository {
  constructor(
    @InjectRepository(SiigoAccount)
    private readonly repository: Repository<SiigoAccount>,
  ) {}

  findByCompanyAndIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<SiigoAccount[]> {
    return this.repository.find({
      where: { companyId, integrationId },
      order: { code: 'ASC' },
    });
  }

  create(
    data: Pick<
      SiigoAccount,
      'companyId' | 'integrationId' | 'code' | 'name' | 'isTransactional'
    >,
  ): SiigoAccount {
    return this.repository.create({
      id: randomUUID(),
      ...data,
    });
  }

  findTransactionalByCompanyAndIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<SiigoAccount[]> {
    return this.repository.find({
      where: {
        companyId,
        integrationId,
        isTransactional: true,
      },
      order: { code: 'ASC' },
    });
  }

  async saveMany(accounts: SiigoAccount[]): Promise<SiigoAccount[]> {
    if (accounts.length === 0) {
      return [];
    }

    return this.repository.save(accounts);
  }
}
