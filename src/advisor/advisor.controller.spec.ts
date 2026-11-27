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
it('devuelve la misma empresa demo aislada a los asesores activos', async () => {
  const profile = { registeredAt: new Date(), user: { active: true, role: UserRole.ADVISOR } };
  const db = {
    getRepository: jest.fn(() => ({ findOne: jest.fn().mockResolvedValue(profile) })),
    query: jest.fn().mockResolvedValue([{ name: 'Empresa demo Jarvis', isDemo: true }]),
  };
  const controller = new AdvisorController(db as never, {} as never, {} as never, {} as never);
  for (const userId of ['advisor-1', 'advisor-2']) {
    await expect(controller.demo({ userId, role: UserRole.ADVISOR } as never))
      .resolves.toEqual({ company: { name: 'Empresa demo Jarvis', isDemo: true } });
  }
  expect(db.query).toHaveBeenCalledTimes(2);
  expect(db.query.mock.calls[0][0]).toContain('advisor_demo_company');
});

it('rechaza asesores sin perfil activo y no consulta datos demo', async () => {
  const db = { getRepository: () => ({ findOne: jest.fn().mockResolvedValue(null) }), query: jest.fn() };
  const controller = new AdvisorController(db as never, {} as never, {} as never, {} as never);
  await expect(controller.demo({ userId: 'unregistered', role: UserRole.ADVISOR } as never)).rejects.toThrow('asesor');
  expect(db.query).not.toHaveBeenCalled();
});

it.each([
  { registeredAt: null, user: { active: true, role: UserRole.ADVISOR } },
  { registeredAt: new Date(), user: { active: false, role: UserRole.ADVISOR } },
  { registeredAt: new Date(), user: { active: true, role: UserRole.USER } },
])('rechaza perfiles que no sean asesores activos registrados', async profile => {
  const db = { getRepository: () => ({ findOne: jest.fn().mockResolvedValue(profile) }), query: jest.fn() };
  const controller = new AdvisorController(db as never, {} as never, {} as never, {} as never);
  await expect(controller.demo({ userId: 'advisor', role: UserRole.ADVISOR } as never)).rejects.toThrow('asesor');
  expect(db.query).not.toHaveBeenCalled();
});

it('notifica si la empresa demo no está configurada', async () => {
  const db = { getRepository: () => ({ findOne: jest.fn().mockResolvedValue({ registeredAt: new Date(), user: { active: true, role: UserRole.ADVISOR } }) }), query: jest.fn().mockResolvedValue([]) };
  const controller = new AdvisorController(db as never, {} as never, {} as never, {} as never);
  await expect(controller.demo({ userId: 'advisor', role: UserRole.ADVISOR } as never)).rejects.toThrow('no está disponible');
});

it('impide consultar o crear facturas demo sin perfil de asesor activo', async () => {
  const db = { getRepository: () => ({ findOne: jest.fn().mockResolvedValue(null) }), query: jest.fn(), transaction: jest.fn() };
  const controller = new AdvisorController(db as never, {} as never, {} as never, {} as never);
  const user = { userId: 'unregistered', role: UserRole.ADVISOR } as never;
  await expect(controller.demoInvoices(user)).rejects.toThrow('asesor');
  await expect(controller.createDemoInvoice(user, {} as never)).rejects.toThrow('asesor');
  expect(db.query).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
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

it('shows created and paid clients without changing ownership or attributing unpaid commissions', async () => {
  const profile = { id: 'advisor-id', registeredAt: new Date(), user: { name: 'Laura', active: true, role: UserRole.ADVISOR } };
  const clients = [
    { id: 'created', name: 'Creada', nit: '900', createdAt: new Date(), integrations: [], commercialActivity: [] },
    { id: 'paid', name: 'Pagada', nit: '901', createdAt: new Date(), integrations: [], commercialActivity: [{ kind: 'PAYMENT' }] },
    { id: 'pending-topup', name: 'Con recarga pendiente', nit: '902', createdAt: new Date(), integrations: [], commercialActivity: [{ kind: 'PAYMENT' }] },
  ];
  const advisors = { findOne: async () => profile }, companies = { find: jest.fn(async () => clients) };
  const report = { pending: [{ companyId: 'pending-topup' }], paid: [], totalCommissionCop: 0 };
  const db = { getRepository: entity => entity === Advisor ? advisors : companies };
  const sales = { report: jest.fn(async () => report) };
  const controller = new AdvisorController(db as never, {} as never, sales as never, {} as never);
  const result = await controller.dashboard({ userId: 'advisor-user', role: UserRole.ADVISOR } as never, '2026-11');
  expect(result.clients.map(client => client.paymentStatus)).toEqual(['PENDING', 'PAID', 'PENDING']);
  expect(companies.find).toHaveBeenCalledWith(expect.objectContaining({ where: { advisorId: 'advisor-id' } }));
  expect(result.commissions).toBe(report);
});
