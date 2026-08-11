import { Company } from '../../company/entities/company.entity';
import { User } from '../entities/user.entity';
import {
  AuthCompanyDto,
  AuthMeResponseDto,
  AuthTokensResponseDto,
  AuthUserDto,
} from '../dto/auth.dto';

export function mapCompanyToAuthCompanyDto(company: Company): AuthCompanyDto {
  return {
    id: company.id,
    name: company.name,
    nit: company.nit,
  };
}

export function mapUserToAuthUserDto(
  user: User,
  company: Company | null,
): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    company: company ? mapCompanyToAuthCompanyDto(company) : null,
  };
}

export function buildAuthTokensResponse(
  accessToken: string,
  refreshToken: string,
  user: User,
  company: Company | null,
  companies: Company[] = company ? [company] : [],
): AuthTokensResponseDto {
  const companyDto = company ? mapCompanyToAuthCompanyDto(company) : null;
  const companiesDto = companies.map(mapCompanyToAuthCompanyDto);

  return {
    accessToken,
    refreshToken,
    user: mapUserToAuthUserDto(user, company),
    company: companyDto,
    companies: companiesDto,
  };
}

export function buildAuthMeResponse(
  user: User,
  company: Company | null,
  companies: Company[] = company ? [company] : [],
): AuthMeResponseDto {
  const companyDto = company ? mapCompanyToAuthCompanyDto(company) : null;

  return {
    user: mapUserToAuthUserDto(user, company),
    company: companyDto,
    companies: companies.map(mapCompanyToAuthCompanyDto),
  };
}
