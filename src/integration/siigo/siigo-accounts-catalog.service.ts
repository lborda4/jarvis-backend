import { Injectable } from '@nestjs/common';
import { collectUniqueAccountsCatalog } from '../helpers/supplier-accounts-catalog.helper';
import { IntegrationsRepository } from '../repositories/integrations.repository';
import { SiigoAccountsRepository } from '../repositories/siigo-accounts.repository';
import { SiigoAccountCatalogItemDto } from './dto/list-siigo-accounts.dto';
import { getSiigoIntegration } from './helpers/siigo-context.helper';

@Injectable()
export class SiigoAccountsCatalogService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly siigoAccountsRepository: SiigoAccountsRepository,
  ) {}

  async listAccounts(companyId: string): Promise<SiigoAccountCatalogItemDto[]> {
    const integration = await getSiigoIntegration(
      this.integrationsRepository,
      companyId,
    );

    const accounts =
      await this.siigoAccountsRepository.findByCompanyAndIntegration(
        companyId,
        integration.id,
      );

    return collectUniqueAccountsCatalog(accounts);
  }
}
