import { AuthService } from './auth.service';
import { UserRole } from './enums/user-role.enum';
import { AuthenticatedUserResolverService } from './services/authenticated-user-resolver.service';

jest.mock('bcrypt', () => ({ compare: jest.fn().mockResolvedValue(true) }));

function setup() {
  const user = { id: 'advisor', email: 'laura@example.com', name: 'Laura', role: UserRole.ADVISOR, active: true, password: 'hash', passwordChangedAt: null };
  const users = { findByEmail: jest.fn().mockResolvedValue(user), findById: jest.fn().mockResolvedValue(user) };
  const links = { findAllByUserId: jest.fn().mockResolvedValue([]), findByUserIdAndCompanyId: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed'), verifyAsync: jest.fn().mockResolvedValue({ sub: user.id, type: 'refresh', companyId: null }) };
  const advisors = { register: jest.fn().mockResolvedValue(user), preview: jest.fn() };
  const service = new AuthService({} as never, jwt as never, { get: () => 'test' } as never, users as never, links as never, { getSubscription: jest.fn().mockResolvedValue({}) } as never, {} as never, advisors as never);
  return { service, user, users, links, jwt, advisors };
}
it('logs in an advisor without selecting or exposing a company', async () => {
  const f = setup(); const result = await f.service.login({ email: f.user.email, password: 'password' });
  expect(result.user).toMatchObject({ role: UserRole.ADVISOR, company: null }); expect(result.companies).toEqual([]);
  expect(f.jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ companyId: null, sub: 'advisor' }), expect.anything());
  expect(f.links.findAllByUserId).toHaveBeenCalledWith('advisor');
});
it('renews an advisor session and retrieves its identity without company access', async () => {
  const f = setup(); await expect(f.service.refresh({ refreshToken: 'refresh' })).resolves.toEqual({ accessToken: 'signed', refreshToken: 'signed' });
  const result = await f.service.getMe({ userId: 'advisor', email: f.user.email, companyId: null, role: UserRole.ADVISOR });
  expect(result.user).toMatchObject({ role: UserRole.ADVISOR, company: null }); expect(result.companies).toEqual([]);
  expect(f.links.findAllByUserId).toHaveBeenCalledWith('advisor'); expect(f.links.findByUserIdAndCompanyId).not.toHaveBeenCalled();
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
  await expect(resolver.resolve({ sub: 'advisor', email: f.user.email, type: 'access', companyId: 'company' })).resolves.toEqual({ userId: 'advisor', email: f.user.email, companyId: 'company', role: UserRole.ADVISOR });
  f.links.findByUserIdAndCompanyId.mockResolvedValue(null);
  await expect(resolver.resolve({ sub: 'advisor', email: f.user.email, type: 'access', companyId: 'company' })).rejects.toThrow();
});

it('lists only linked companies on login and me, keeping the commercial landing company-free', async () => {
  const f = setup();
  const company = { id: 'owned-company', name: 'Mi empresa', nit: '900123456' };
  f.links.findAllByUserId.mockResolvedValue([{ company }]);
  const login = await f.service.login({ email: f.user.email, password: 'password' });
  const me = await f.service.getMe({ userId: 'advisor', email: f.user.email, companyId: null });
  for (const result of [login, me]) {
    expect(result.user).toMatchObject({ role: UserRole.ADVISOR, company: null });
    expect(result.companies).toEqual([expect.objectContaining(company)]);
  }
});
it('switches into a linked company without changing the advisor role and keeps it on refresh and me', async () => {
  const f = setup();
  const company = { id: 'owned-company', name: 'Mi empresa', nit: '900123456' };
  f.links.findAllByUserId.mockResolvedValue([{ company }]);
  f.links.findByUserIdAndCompanyId.mockResolvedValue({ user: f.user, companyId: company.id, company });
  const session = await f.service.switchCompany({ userId: 'advisor', email: f.user.email, companyId: null }, { companyId: company.id });
  expect(session.user).toMatchObject({ role: UserRole.ADVISOR, company });
  expect(f.links.findByUserIdAndCompanyId).toHaveBeenCalledWith('advisor', company.id);
  const me = await f.service.getMe({ userId: 'advisor', email: f.user.email, companyId: company.id });
  expect(me.user).toMatchObject({ role: UserRole.ADVISOR, company });
  f.jwt.verifyAsync.mockResolvedValue({ sub: 'advisor', type: 'refresh', companyId: company.id });
  await expect(f.service.refresh({ refreshToken: 'refresh' })).resolves.toMatchObject({ accessToken: 'signed' });
  expect(f.jwt.signAsync).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: company.id }), expect.anything());
});
it('rejects a sales portfolio company with no UserCompany membership on switch, me, refresh and JWT resolution', async () => {
  const f = setup();
  const identity = { userId: 'advisor', email: f.user.email, companyId: 'portfolio-only' };
  await expect(f.service.switchCompany(identity, { companyId: 'portfolio-only' })).rejects.toThrow();
  await expect(f.service.getMe(identity)).rejects.toThrow();
  f.jwt.verifyAsync.mockResolvedValue({ sub: 'advisor', type: 'refresh', companyId: 'portfolio-only' });
  await expect(f.service.refresh({ refreshToken: 'refresh' })).rejects.toThrow();
  const resolver = new AuthenticatedUserResolverService(f.users as never, f.links as never);
  await expect(resolver.resolve({ sub: 'advisor', email: f.user.email, type: 'access', companyId: 'portfolio-only' })).rejects.toThrow();
  expect(f.jwt.signAsync).not.toHaveBeenCalled();
});

it('lists only linked companies and validates switching, refresh and membership revocation', async () => {
  const f = setup();
  const company = { id: 'linked', name: 'Empresa', nit: '123' };
  f.links.findAllByUserId.mockResolvedValue([{ company }]);
  f.links.findByUserIdAndCompanyId.mockImplementation(async (_userId, id) => id === company.id ? { company, companyId: company.id, user: f.user } : null);
  const login = await f.service.login({ email: f.user.email, password: 'password' });
  expect(login.user.company).toBeNull();
  expect(login.companies).toEqual([expect.objectContaining({ id: 'linked' })]);
  const current = { userId: f.user.id, email: f.user.email, companyId: null, role: UserRole.ADVISOR };
  await expect(f.service.switchCompany(current, { companyId: 'other' })).rejects.toThrow();
  const switched = await f.service.switchCompany(current, { companyId: 'linked' });
  expect(switched.user.company).toMatchObject({ id: 'linked' });
  const scoped = { ...current, companyId: 'linked' };
  expect((await f.service.getMe(scoped)).user.company).toMatchObject({ id: 'linked' });
  f.jwt.verifyAsync.mockResolvedValue({ sub: f.user.id, type: 'refresh', companyId: 'linked' });
  await expect(f.service.refresh({ refreshToken: 'refresh' })).resolves.toEqual({ accessToken: 'signed', refreshToken: 'signed' });
  f.links.findByUserIdAndCompanyId.mockResolvedValue(null);
  await expect(f.service.getMe(scoped)).rejects.toThrow();
  await expect(f.service.refresh({ refreshToken: 'refresh' })).rejects.toThrow();
});
