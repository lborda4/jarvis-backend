import { ExecutionContext } from '@nestjs/common';
import { AdvisorAccessGuard } from './advisor-access.guard';
import { UserRole } from '../enums/user-role.enum';
import { resolveActiveCompanyId } from '../helpers/authenticated-company.helper';

const context = (role: UserRole | undefined, method: string, originalUrl: string, companyId: string | null = null) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user: role ? { role, companyId } : undefined, method, originalUrl }) }) }) as ExecutionContext;
it('keeps advisor sessions limited to their own authenticated identity', () => {
  const guard = new AdvisorAccessGuard();
  expect(guard.canActivate(context(UserRole.ADVISOR, 'GET', '/auth/me?test=1'))).toBe(true);
  expect(guard.canActivate(context(UserRole.ADVISOR, 'GET', '/advisor/demo'))).toBe(true);
  expect(guard.canActivate(context(UserRole.ADVISOR, 'POST', '/auth/switch-company'))).toBe(true);
  for (const [method, path] of [['GET', '/admin/advisors'], ['GET', '/company'], ['POST', '/auth/me'], ['POST', '/jarvis/send']]) expect(() => guard.canActivate(context(UserRole.ADVISOR, method, path))).toThrow();
  expect(guard.canActivate(context(UserRole.ADVISOR, 'POST', '/jarvis/send', 'linked'))).toBe(true);
  expect(() => guard.canActivate(context(UserRole.ADVISOR, 'GET', '/admin/advisors', 'linked'))).toThrow();
  expect(guard.canActivate(context(undefined, 'POST', '/auth/advisor-registration'))).toBe(true);
  expect(guard.canActivate(context(UserRole.ADMIN, 'GET', '/admin/advisors'))).toBe(true);
});
it('allows advisor sessions with or without a company', () => {
  expect(resolveActiveCompanyId(null, UserRole.ADVISOR, 'invalid')).toBe('');
  expect(resolveActiveCompanyId('company', UserRole.ADVISOR, 'invalid')).toBe('company');
  expect(() => resolveActiveCompanyId(null, UserRole.USER, 'invalid')).toThrow();
});
