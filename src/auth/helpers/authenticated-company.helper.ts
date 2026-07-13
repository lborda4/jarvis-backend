import { BadRequestException } from '@nestjs/common';
import { Company } from '../../company/entities/company.entity';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

export function getAuthenticatedCompanyId(user: AuthenticatedUser): string {
  const companyId = user.companyId?.trim();

  if (!companyId) {
    throw new BadRequestException(
      'El token no contiene una empresa activa válida.',
    );
  }

  return companyId;
}

export async function resolveAuthenticatedCompany(
  companiesRepository: CompaniesRepository,
  user: AuthenticatedUser,
): Promise<Company> {
  const companyId = getAuthenticatedCompanyId(user);
  const company = await companiesRepository.findById(companyId);

  if (!company) {
    throw new BadRequestException(
      `No se encontró la empresa activa con id ${companyId}.`,
    );
  }

  return company;
}
