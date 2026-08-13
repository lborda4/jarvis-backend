import {
  generateCompanyInviteCode,
  normalizeCompanyInviteCode,
} from './company-invite-code.helper';

describe('generateCompanyInviteCode', () => {
  it('generates a 10-character uppercase alphanumeric code', () => {
    const code = generateCompanyInviteCode();
    expect(code).toHaveLength(10);
    expect(code).toMatch(/^[A-Z2-9]+$/);
  });

  it('never generates ambiguous characters (0/O/1/I/L)', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCompanyInviteCode()).not.toMatch(/[0O1IL]/);
    }
  });

  it('generates distinct codes across calls', () => {
    const codes = new Set(
      Array.from({ length: 50 }, () => generateCompanyInviteCode()),
    );
    expect(codes.size).toBe(50);
  });
});

describe('normalizeCompanyInviteCode', () => {
  it('uppercases and strips separators/spaces', () => {
    expect(normalizeCompanyInviteCode(' ab3d-efgh 2k ')).toBe('AB3DEFGH2K');
  });

  it('returns an empty string for null/undefined', () => {
    expect(normalizeCompanyInviteCode(null)).toBe('');
    expect(normalizeCompanyInviteCode(undefined)).toBe('');
  });
});
