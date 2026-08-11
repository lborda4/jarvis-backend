export type JwtTokenType = 'access' | 'refresh';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  /** Vacío o ausente solo para admin sin empresa asociada. */
  companyId?: string | null;
  type: JwtTokenType;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  /** Vacío o ausente solo para admin sin empresa asociada. */
  companyId?: string | null;
}
