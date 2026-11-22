import { AdvisorController, AdvisorGuard } from './advisor.controller';
import { Advisor } from '../auth/entities/advisor.entity';
import { Company } from '../company/entities/company.entity';
import { UserRole } from '../auth/enums/user-role.enum';
import type { ExecutionContext } from '@nestjs/common';

it('allows only authenticated advisors to use the commercial endpoints', () => {
  const guard = new AdvisorGuard();
  const context = role => ({ switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) }) as ExecutionContext;
  expect(guard.canActivate(context(UserRole.ADVISOR))).toBe(true);
  expect(() => guard.canActivate(context(UserRole.USER))).toThrow(); expect(() => guard.canActivate(context(UserRole.ADMIN))).toThrow();
});
it('uses the advisor profile from the authenticated user for clients, reports and creation', async () => {
  const profile = { id: 'advisor-id', userId: 'user', registeredAt: new Date(), user: { name: 'Laura', active: true, role: UserRole.ADVISOR } };
  const advisors = { findOne: jest.fn(async () => profile) }, companies = { find: jest.fn(async () => []) };
  const db = { getRepository: entity => entity === Advisor ? advisors : entity === Company ? companies : null };
  const admin = { createCompany: jest.fn(async () => ({ company: { id: 'created', registrationEmail: 'client@example.com', nextPymeToken: 'private', technicalKey: 'private', inviteCode: 'private' } })) };
  const sales = { report: jest.fn(async () => ({})) }, invitations = { send: jest.fn(async () => ({ status: 'SENT' })) };
  const controller = new AdvisorController(db as never, admin as never, sales as never, invitations as never);
  const user = { userId: 'user', email: 'advisor@example.com', companyId: null, role: UserRole.ADVISOR };
  await controller.dashboard(user, '2026-11');
  expect(advisors.findOne).toHaveBeenCalledWith({ where: { userId: 'user' }, relations: { user: true } });
  expect(companies.find).toHaveBeenCalledWith(expect.objectContaining({ where: { advisorId: 'advisor-id' } }));
  expect(sales.report).toHaveBeenCalledWith('2026-11', 'advisor-id');
  const request = { name: 'Cliente', advisorId: 'attacker', commercial: 'Otro' };
  const result = await controller.create(user, request as never);
  expect(admin.createCompany).toHaveBeenCalledWith(request, 'user', profile);
  expect(result.company).toMatchObject({ nextPymeToken: null, technicalKey: null, inviteCode: '' });
  expect(invitations.send).toHaveBeenCalledWith('created', 'client@example.com', 'user');
});
