import { CompanyPersonType } from '../../company/enums/company-person-type.enum';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';
import { JarvisCredentialsSeedDto } from '../../integration/jarvis/dto/jarvis-credentials-seed.dto';

export class RegisterCompanyResponsibleDto {
  name: string;
  phone: string;
  email: string;
}

export class RegisterCompanyDto {
  name: string;
  nit: string;
  personType: CompanyPersonType;
  provider: IntegrationProvider;
  responsible: RegisterCompanyResponsibleDto;
  jarvisCredentials?: JarvisCredentialsSeedDto;
}

export class RegisterRequestDto {
  name: string;
  email: string;
  password: string;
  company: RegisterCompanyDto;
}

export class LoginRequestDto {
  email: string;
  password: string;
}

export class RefreshTokenRequestDto {
  refreshToken: string;
}

export class AuthUserDto {
  id: string;
  name: string;
  email: string;
  role: string;
  company: AuthCompanyDto;
}

export class AuthCompanyDto {
  id: string;
  name: string;
  nit: string;
}

export class AuthTokensResponseDto {
  accessToken: string;
  refreshToken: string;
  user: AuthUserDto;
  company: AuthCompanyDto;
  companies: AuthCompanyDto[];
}

export class AuthMeResponseDto {
  user: AuthUserDto;
  company: AuthCompanyDto;
  companies: AuthCompanyDto[];
}

export class SwitchCompanyRequestDto {
  companyId: string;
}

export class RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
}
