import { AuthService } from './auth.service';
import { AuthenticatedUserResolverService } from './services/authenticated-user-resolver.service';
import { UserRole } from './enums/user-role.enum';
import { SHARED_DEMO_COMPANY_ID } from '../advisor/shared-demo.constants';

function setup() {
  const user = {
    id: 'commercial',
    email: 'commercial@example.test',
    name: 'Comercial',
    active: true,
    role: UserRole.ADVISOR,
  };
  const demo = {
    id: SHARED_DEMO_COMPANY_ID,
    name: 'Empresa demo Jarvis',
    nit: '900000000',
    isDemo: true,
  };
  const real = {
    id: 'real-company',
    name: 'Empresa real',
    nit: '900123456',
    isDemo: false,
  };
  const users = { findById: jest.fn().mockResolvedValue(user) };
  const links = {
    findAllByUserId: jest.fn(async () => [
      { company: real },
      { company: demo },
    ]),
    findByUserIdAndCompanyId: jest.fn(async (_user: string, id: string) => ({
      user,
      companyId: id,
      company: id === demo.id ? demo : real,
    })),
  };
  const jwt = {
    signAsync: jest.fn().mockResolvedValue('signed'),
    verifyAsync: jest
      .fn()
      .mockResolvedValue({ sub: user.id, type: 'refresh', companyId: demo.id }),
  };
  const service = new AuthService(
    {} as never,
    jwt as never,
    { get: () => '' } as never,
    users as never,
    links as never,
    { getSubscription: async () => ({}) } as never,
    {} as never,
  );
  const identity = {
    userId: user.id,
    email: user.email,
    role: user.role,
    companyId: demo.id,
  };
  return { user, demo, real, users, links, jwt, service, identity };
}
it('uses normal company sessions to move between shared demo and real memberships and survives refresh', async () => {
  const f = setup();
  const session = await f.service.switchCompany(f.identity, {
    companyId: f.demo.id,
  });
  expect(session.user.company).toMatchObject({ id: f.demo.id, isDemo: true });
  expect(session.companies.map((company) => company.id)).toEqual([
    f.real.id,
    f.demo.id,
  ]);
  expect((await f.service.getMe(f.identity)).user.company).toMatchObject({
    id: f.demo.id,
    isDemo: true,
  });
  await expect(
    f.service.refresh({ refreshToken: 'token' }),
  ).resolves.toMatchObject({ accessToken: 'signed' });
  const resolver = new AuthenticatedUserResolverService(
    f.users as never,
    f.links as never,
  );
  await expect(
    resolver.resolve({
      sub: f.user.id,
      email: f.user.email,
      type: 'access',
      companyId: f.demo.id,
    }),
  ).resolves.toMatchObject({ companyId: f.demo.id, role: UserRole.ADVISOR });
  expect(
    (await f.service.switchCompany(f.identity, { companyId: f.real.id })).user
      .company,
  ).toMatchObject({ id: f.real.id });
});
it('revokes demo access on switch, refresh, me and authenticated requests when the user stops being an advisor', async () => {
  const f = setup();
  f.user.role = UserRole.USER;
  await expect(
    f.service.switchCompany(f.identity, { companyId: f.demo.id }),
  ).rejects.toThrow();
  await expect(f.service.getMe(f.identity)).rejects.toThrow();
  await expect(f.service.refresh({ refreshToken: 'token' })).rejects.toThrow();
  const resolver = new AuthenticatedUserResolverService(
    f.users as never,
    f.links as never,
  );
  await expect(
    resolver.resolve({
      sub: f.user.id,
      email: f.user.email,
      type: 'access',
      companyId: f.demo.id,
    }),
  ).rejects.toThrow();
  const realSession = await f.service.switchCompany(f.identity, {
    companyId: f.real.id,
  });
  expect(realSession.companies.map((company) => company.id)).toEqual([
    f.real.id,
  ]);
});
