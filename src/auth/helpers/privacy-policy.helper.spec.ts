import { BadRequestException } from '@nestjs/common';
import { AUTH_ERROR_CODE } from '../constants/auth-error.constants';
import { PRIVACY_POLICY_VERSION } from '../constants/privacy-policy.constants';
import { User } from '../entities/user.entity';
import {
  applyPrivacyConsent,
  assertPrivacyPolicyAccepted,
  isPrivacyPolicyAccepted,
} from './privacy-policy.helper';

describe('privacy-policy.helper', () => {
  it('acepta solo el booleano true', () => {
    expect(isPrivacyPolicyAccepted(true)).toBe(true);
    expect(isPrivacyPolicyAccepted(false)).toBe(false);
    expect(isPrivacyPolicyAccepted('true')).toBe(false);
    expect(isPrivacyPolicyAccepted(undefined)).toBe(false);
  });

  it('rechaza el registro sin autorización explícita', () => {
    expect(() => assertPrivacyPolicyAccepted(false)).toThrow(
      BadRequestException,
    );

    try {
      assertPrivacyPolicyAccepted(undefined);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: AUTH_ERROR_CODE.PRIVACY_POLICY_NOT_ACCEPTED,
        }),
      );
    }
  });

  it('guarda la primera aceptación y no pisa una anterior', () => {
    const user = { acceptedPrivacyAt: null, privacyPolicyVersion: null } as User;
    const firstAcceptedAt = new Date('2026-10-08T12:00:00.000Z');

    applyPrivacyConsent(user, firstAcceptedAt);

    expect(user.acceptedPrivacyAt).toEqual(firstAcceptedAt);
    expect(user.privacyPolicyVersion).toBe(PRIVACY_POLICY_VERSION);

    applyPrivacyConsent(user, new Date('2026-11-01T00:00:00.000Z'));

    expect(user.acceptedPrivacyAt).toEqual(firstAcceptedAt);
  });
});
