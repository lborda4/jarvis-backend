import { BadRequestException } from '@nestjs/common';
import { Company } from '../../../company/entities/company.entity';
import { CompaniesRepository } from '../../../company/repositories/companies.repository';
import { Integration } from '../../entities/integration.entity';
import { IntegrationProvider } from '../../enums/integration-provider.enum';
import { IntegrationsRepository } from '../../repositories/integrations.repository';

export async function resolveSiigoCompany(
  companiesRepository: CompaniesRepository,
  companyId: string,
): Promise<Company> {
  const trimmedCompanyId = companyId?.trim();

  if (!trimmedCompanyId) {
    throw new BadRequestException(
      'No se pudo determinar la empresa activa del usuario autenticado.',
    );
  }

  const company = await companiesRepository.findById(trimmedCompanyId);

  if (!company) {
    throw new BadRequestException(
      `No se encontró la empresa con id ${trimmedCompanyId}.`,
    );
  }

  return company;
}

export async function getSiigoIntegration(
  integrationsRepository: IntegrationsRepository,
  companyId: string,
): Promise<Integration> {
  const trimmedCompanyId = companyId?.trim();

  if (!trimmedCompanyId) {
    throw new BadRequestException(
      'No se pudo determinar la empresa activa del usuario autenticado.',
    );
  }

  const integration = await integrationsRepository.findByCompanyAndProvider(
    trimmedCompanyId,
    IntegrationProvider.SIIGO,
  );

  if (!integration) {
    throw new BadRequestException(
      'No existe una integración SIIGO configurada para esta empresa. Guarde las credenciales en POST /integrations/siigo/credentials.',
    );
  }

  return integration;
}

export function normalizeSupplierDocument(identification: string): string {
  return identification.replace(/[^\d]/g, '');
}
