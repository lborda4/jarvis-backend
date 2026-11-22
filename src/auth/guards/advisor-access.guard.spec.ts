import { ExecutionContext } from '@nestjs/common';
import { AdvisorAccessGuard } from './advisor-access.guard';
import { UserRole } from '../enums/user-role.enum';
import { resolveActiveCompanyId } from '../helpers/authenticated-company.helper';

const context = (role: UserRole | undefined, method: string, originalUrl: string) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined, method, originalUrl }) }) }) as ExecutionContext;
it('keeps advisor sessions limited to their own authenticated identity', () => {
  const guard = new AdvisorAccessGuard();
  expect(guard.canActivate(context(UserRole.ADVISOR, 'GET', '/auth/me?test=1'))).toBe(true);
  for (const [method, path] of [['GET', '/admin/advisors'], ['GET', '/company'], ['POST', '/auth/switch-company'], ['POST', '/auth/me'], ['POST', '/jarvis/send']]) expect(() => guard.canActivate(context(UserRole.ADVISOR, method, path))).toThrow();
  expect(guard.canActivate(context(undefined, 'POST', '/auth/advisor-registration'))).toBe(true);
  expect(guard.canActivate(context(UserRole.ADMIN, 'GET', '/admin/advisors'))).toBe(true);
});
it('allows advisor login without a company and rejects company-scoped advisor sessions', () => {
  expect(resolveActiveCompanyId(null, UserRole.ADVISOR, 'invalid')).toBe('');
  expect(() => resolveActiveCompanyId('company', UserRole.ADVISOR, 'invalid')).toThrow();
  expect(() => resolveActiveCompanyId(null, UserRole.USER, 'invalid')).toThrow();
});
