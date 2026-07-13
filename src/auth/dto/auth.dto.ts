export class RegisterCompanyDto {
  name: string;
  nit: string;
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
}

export class AuthMeResponseDto {
  user: AuthUserDto;
  company: AuthCompanyDto;
}

export class RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
}
