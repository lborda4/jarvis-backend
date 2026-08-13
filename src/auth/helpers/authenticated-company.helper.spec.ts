import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';
import { resolveActiveCompanyId } from './authenticated-company.helper';

describe('resolveActiveCompanyId', () => {
  it('returns the trimmed companyId when present', () => {
    expect(
      resolveActiveCompanyId(' company-1 ', UserRole.USER, 'msg'),
    ).toBe('company-1');
  });

  it('returns an empty string for an ADMIN without an active company', () => {
    expect(resolveActiveCompanyId('', UserRole.ADMIN, 'msg')).toBe('');
    expect(resolveActiveCompanyId(null, UserRole.ADMIN, 'msg')).toBe('');
    expect(resolveActiveCompanyId(undefined, UserRole.ADMIN, 'msg')).toBe(
      '',
    );
  });

  it('throws UnauthorizedException for a non-ADMIN without an active company', () => {
    expect(() =>
      resolveActiveCompanyId('', UserRole.USER, 'sin empresa activa'),
    ).toThrow(UnauthorizedException);
    expect(() =>
      resolveActiveCompanyId('', UserRole.USER, 'sin empresa activa'),
    ).toThrow('sin empresa activa');
  });
});
