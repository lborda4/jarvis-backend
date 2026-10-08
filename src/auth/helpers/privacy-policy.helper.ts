import { BadRequestException } from '@nestjs/common';
import {
  AUTH_ERROR_CODE,
  AUTH_ERROR_MESSAGE,
} from '../constants/auth-error.constants';
import { PRIVACY_POLICY_VERSION } from '../constants/privacy-policy.constants';
import { User } from '../entities/user.entity';

export function isPrivacyPolicyAccepted(value: unknown): boolean {
  return value === true;
}

export function assertPrivacyPolicyAccepted(value: unknown): void {
  if (!isPrivacyPolicyAccepted(value)) {
    throw new BadRequestException({
      message: AUTH_ERROR_MESSAGE.PRIVACY_POLICY_NOT_ACCEPTED,
      code: AUTH_ERROR_CODE.PRIVACY_POLICY_NOT_ACCEPTED,
    });
  }
}

export function applyPrivacyConsent(user: User, now = new Date()): void {
  if (user.acceptedPrivacyAt) {
    return;
  }

  user.acceptedPrivacyAt = now;
  user.privacyPolicyVersion = PRIVACY_POLICY_VERSION;
}
