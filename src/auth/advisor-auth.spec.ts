import { AuthService } from './auth.service';
import { UserRole } from './enums/user-role.enum';
import { AuthenticatedUserResolverService } from './services/authenticated-user-resolver.service';

jest.mock('bcrypt', () => ({ compare: jest.fn().mockResolvedValue(true) }));

function setup() {
  const user = { id: 'advisor', email: 'laura@example.com', name: 'Laura', role: UserRole.ADVISOR, active: true, password: 'hash', passwordChangedAt: null };
  const users = { findByEmail: jest.fn().mockResolvedValue(user), findById: jest.fn().mockResolvedValue(user) };
  const links = { findAllByUserId: jest.fn(() => { throw Error('Advisor must not load company links'); }), findByUserIdAndCompanyId: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed'), verifyAsync: jest.fn().mockResolvedValue({ sub: user.id, type: 'refresh', companyId: null }) };
  const advisors = { register: jest.fn().mockResolvedValue(user), preview: jest.fn() };
  const service = new AuthService({} as never, jwt as never, { get: () => 'test' } as never, users as never, links as never, {} as never, {} as never, advisors as never);
  return { service, user, users, links, jwt, advisors };
}
it('logs in an advisor without selecting or exposing a company', async () => {
  const f = setup(); const result = await f.service.login({ email: f.user.email, password: 'password' });
  expect(result.user).toMatchObject({ role: UserRole.ADVISOR, company: null }); expect(result.companies).toEqual([]);
  expect(f.jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ companyId: null, sub: 'advisor' }), expect.anything());
  expect(f.links.findAllByUserId).not.toHaveBeenCalled();
});
it('renews an advisor session and retrieves its identity without company access', async () => {
  const f = setup(); await expect(f.service.refresh({ refreshToken: 'refresh' })).resolves.toEqual({ accessToken: 'signed', refreshToken: 'signed' });
  const result = await f.service.getMe({ userId: 'advisor', email: f.user.email, companyId: null, role: UserRole.ADVISOR });
  expect(result.user).toMatchObject({ role: UserRole.ADVISOR, company: null }); expect(result.companies).toEqual([]);
  expect(f.links.findAllByUserId).not.toHaveBeenCalled(); expect(f.links.findByUserIdAndCompanyId).not.toHaveBeenCalled();
});
it('completes advisor registration with the fixed invited identity and a company-free session', async () => {
  const f = setup(); const request = { registrationToken: 'token', password: 'password', acceptPrivacyPolicy: true };
  const result = await f.service.registerAdvisor(request);
  expect(f.advisors.register).toHaveBeenCalledWith(request); expect(result.user).toMatchObject({ id: 'advisor', role: UserRole.ADVISOR, company: null });
});
it('resolves the advisor role from the database, allowing the global access guard to enforce it', async () => {
  const f = setup(); const resolver = new AuthenticatedUserResolverService(f.users as never, f.links as never);
  await expect(resolver.resolve({ sub: 'advisor', email: f.user.email, type: 'access', companyId: null })).resolves.toEqual({ userId: 'advisor', email: f.user.email, companyId: null, role: UserRole.ADVISOR });
  f.links.findByUserIdAndCompanyId.mockResolvedValue({ user: f.user, companyId: 'company', company: { id: 'company' } });
  await expect(resolver.resolve({ sub: 'advisor', email: f.user.email, type: 'access', companyId: 'company' })).rejects.toThrow();
});
