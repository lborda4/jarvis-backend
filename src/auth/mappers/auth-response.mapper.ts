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
  company: Company,
): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    company: mapCompanyToAuthCompanyDto(company),
  };
}

export function buildAuthTokensResponse(
  accessToken: string,
  refreshToken: string,
  user: User,
  company: Company,
  companies: Company[] = [company],
): AuthTokensResponseDto {
  const companyDto = mapCompanyToAuthCompanyDto(company);
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
  company: Company,
  companies: Company[] = [company],
): AuthMeResponseDto {
  const companyDto = mapCompanyToAuthCompanyDto(company);

  return {
    user: mapUserToAuthUserDto(user, company),
    company: companyDto,
    companies: companies.map(mapCompanyToAuthCompanyDto),
  };
}
