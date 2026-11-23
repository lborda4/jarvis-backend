import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminAdvisorsController } from '../admin/admin-advisors.controller';
import { AdminGuard } from '../admin/guards/admin.guard';
import { AdvisorPortalService } from './advisor-portal.service';
import { Advisor } from '../auth/entities/advisor.entity';
import { Company } from '../company/entities/company.entity';
import { UserRole } from '../auth/enums/user-role.enum';

it('protects all admin advisor portal routes and rejects non-admin accounts', async () => {
  expect(Reflect.getMetadata(GUARDS_METADATA, AdminAdvisorsController)).toContain(AdminGuard);
  const users = { findById: jest.fn(async () => ({ role: UserRole.ADVISOR })) };
  const guard = new AdminGuard(users as never);
  const context = { switchToHttp: () => ({ getRequest: () => ({ user: { userId: 'actor' } }) }) };
  await expect(guard.canActivate(context as never)).rejects.toThrow('Acceso restringido');
  users.findById.mockResolvedValue({ role: UserRole.ADMIN });
  expect(await guard.canActivate(context as never)).toBe(true);
});

it('scopes the dashboard and new company to the selected advisor while retaining the admin actor', async () => {
  const profile = { id: 'advisor-b', user: { name: 'Carlos' } };
  const advisors = { findOne: jest.fn(async () => profile) }, companies = { find: jest.fn(async () => []) };
  const db = { getRepository: entity => entity === Advisor ? advisors : entity === Company ? companies : null };
  const sales = { report: jest.fn(async () => ({ pending: [], paid: [] })) };
  const admin = { createCompany: jest.fn(async () => ({ company: { id: 'client', registrationEmail: 'client@example.test', nextPymeToken: 'secret', technicalKey: 'secret', inviteCode: 'secret', idSoftware: 'secret' } })) };
  const invitations = { send: jest.fn(async () => ({ status: 'SENT' })) };
  const portal = new AdvisorPortalService(db as never, admin as never, sales as never, invitations as never);
  const controller = new AdminAdvisorsController({} as never, portal, admin as never);
  const dashboard = await controller.dashboard('advisor-b', '2026-11');
  expect(dashboard.advisor).toEqual({ id: 'advisor-b', name: 'Carlos' });
  expect(advisors.findOne).toHaveBeenCalledWith({ where: { id: 'advisor-b' }, relations: { user: true } });
  expect(companies.find).toHaveBeenCalledWith(expect.objectContaining({ where: { advisorId: 'advisor-b' } }));
  expect(sales.report).toHaveBeenCalledWith('2026-11', 'advisor-b');
  expect(invitations.send).not.toHaveBeenCalled();
  const actor = { userId: 'admin-actor', role: UserRole.ADMIN };
  const input = { name: 'Cliente', advisorId: 'attacker', commercial: 'Otro' };
  const result = await controller.createClient('advisor-b', actor as never, input as never);
  expect(admin.createCompany).toHaveBeenCalledWith(input, 'admin-actor', profile);
  expect(invitations.send).toHaveBeenCalledWith('client', 'client@example.test', 'admin-actor');
  expect(result.company).toMatchObject({ nextPymeToken: null, technicalKey: null, inviteCode: '', idSoftware: null });
});

it('does not fall back to another advisor when the selected profile is missing', async () => {
  const portal = new AdvisorPortalService({ getRepository: () => ({ findOne: async () => null }) } as never, {} as never, {} as never, {} as never);
  await expect(portal.profile('missing')).rejects.toThrow('Asesor no encontrado');
});
