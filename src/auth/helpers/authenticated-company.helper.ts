import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Company } from '../../company/entities/company.entity';
import { CompaniesRepository } from '../../company/repositories/companies.repository';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { UserRole } from '../enums/user-role.enum';

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

/**
 * Normaliza un companyId (de un JWT o del usuario autenticado) y valida que,
 * si viene vacío, solo un ADMIN pueda continuar sin empresa activa.
 * Devuelve '' cuando el usuario es ADMIN sin empresa; lanza si no lo es.
 */
export function resolveActiveCompanyId(
  rawCompanyId: string | null | undefined,
  role: UserRole,
  message: string,
): string {
  const companyId = rawCompanyId?.trim() ?? '';

  if (!companyId && role !== UserRole.ADMIN) {
    throw new UnauthorizedException(message);
  }

  return companyId;
}
