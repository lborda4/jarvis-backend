export class RegisterRequestDto {
  name: string;
  email: string;
  password: string;
  nit: string;
  inviteCode: string;
  acceptPrivacyPolicy: boolean;
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
  company: AuthCompanyDto | null;
}

export class AuthCompanyDto {
  id: string;
  name: string;
  nit: string;
}

export class DocumentQuotaNoticeDto {
  code: 'LOW' | 'EXHAUSTED';
  message: string;
  remaining: number;
  documentLimit: number;
  documentsUsed: number;
}

export class AuthTokensResponseDto {
  accessToken: string;
  refreshToken: string;
  user: AuthUserDto;
  company: AuthCompanyDto | null;
  companies: AuthCompanyDto[];
  documentQuotaNotice?: DocumentQuotaNoticeDto | null;
}

export class AuthMeResponseDto {
  user: AuthUserDto;
  company: AuthCompanyDto | null;
  companies: AuthCompanyDto[];
  documentQuotaNotice?: DocumentQuotaNoticeDto | null;
}

export class SwitchCompanyRequestDto {
  companyId: string;
}

export class RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
}
