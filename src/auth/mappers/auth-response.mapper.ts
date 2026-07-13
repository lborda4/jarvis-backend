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
    company: mapCompanyToAuthCompanyDto(company),
  };
}

export function buildAuthTokensResponse(
  accessToken: string,
  refreshToken: string,
  user: User,
  company: Company,
): AuthTokensResponseDto {
  const companyDto = mapCompanyToAuthCompanyDto(company);

  return {
    accessToken,
    refreshToken,
    user: mapUserToAuthUserDto(user, company),
    company: companyDto,
  };
}

export function buildAuthMeResponse(
  user: User,
  company: Company,
): AuthMeResponseDto {
  const companyDto = mapCompanyToAuthCompanyDto(company);

  return {
    user: mapUserToAuthUserDto(user, company),
    company: companyDto,
  };
}
