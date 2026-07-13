import { SetMetadata } from '@nestjs/common';
import { AUTH_PUBLIC_KEY } from '../constants/auth.constants';

export const Public = () => SetMetadata(AUTH_PUBLIC_KEY, true);
