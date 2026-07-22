export const AUTH_ERROR_CODE = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  NO_ACTIVE_COMPANY: 'NO_ACTIVE_COMPANY',
  COMPANY_NOT_LINKED: 'COMPANY_NOT_LINKED',
  USER_ALREADY_LINKED_TO_COMPANY: 'USER_ALREADY_LINKED_TO_COMPANY',
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODE)[keyof typeof AUTH_ERROR_CODE];

export const AUTH_ERROR_MESSAGE = {
  ACCOUNT_NOT_FOUND: 'No existe una cuenta con ese correo.',
  INVALID_PASSWORD: 'La contraseña es incorrecta.',
  ACCOUNT_INACTIVE: 'La cuenta está inactiva. Contacte al administrador.',
  NO_ACTIVE_COMPANY: 'El usuario no tiene una empresa activa asociada.',
  COMPANY_NOT_LINKED: 'No tienes acceso a una empresa con ese NIT.',
  USER_ALREADY_LINKED_TO_COMPANY:
    'Este usuario ya está vinculado a la empresa con ese NIT.',
} as const;
