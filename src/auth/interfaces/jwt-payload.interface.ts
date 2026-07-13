export type JwtTokenType = 'access' | 'refresh';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  companyId: string;
  type: JwtTokenType;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  companyId: string;
}
