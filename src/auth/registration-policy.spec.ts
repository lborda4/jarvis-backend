import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { registrationPolicy, assertRegistrationPolicy } from './helpers/registration-policy.helper';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hash'), compare: jest.fn().mockResolvedValue(true) }));

function setup(provider = IntegrationProvider.JARVIS) {
  const company = { id: 'company', name: 'Empresa', registrationEmail: 'fixed@example.com', responsible: null as { name: string } | null, integrations: [{ provider, active: true }] };
  const users = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(value => ({ id: 'user', ...value })), save: jest.fn(async value => value) };
  const links = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(value => value), save: jest.fn(async value => value) };
  const query = jest.fn().mockResolvedValue([]);
  const manager = { query, getRepository: jest.fn(entity => entity === User ? users : links) };
  const db = { transaction: jest.fn(async work => work(manager)) };
  const invitations = { resolve: jest.fn().mockResolvedValue({ invitationId: 'invite', email: 'fixed@example.com', company }), preview: jest.fn().mockResolvedValue({ email: 'fixed@example.com' }) };
  const service = new AuthService(db as never, {} as never, {} as never, {} as never, {} as never, {} as never, invitations as never);
  jest.spyOn(service as unknown as { buildAuthResponse: () => Promise<unknown> }, 'buildAuthResponse').mockResolvedValue({});
  const request = { registrationToken: 'a'.repeat(43), password: 'password123', acceptPrivacyPolicy: true, acceptedIntegrationPolicyId: registrationPolicy(company.integrations).policyId };
  return { service, request, query, company, users, links, manager, invitations };
}

it.each([IntegrationProvider.JARVIS, IntegrationProvider.SIIGO])('registra con correo y empresa del enlace y guarda consentimiento de %s', async provider => {
  const { service, request, query, company, users, links, manager, invitations } = setup(provider);
  await service.register(request);
  expect(invitations.resolve).toHaveBeenCalledWith(request.registrationToken, manager);
  expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'fixed@example.com', name: 'Empresa' }));
  const policy = registrationPolicy(company.integrations);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id, company_id, policy_id) DO NOTHING'), ['user', 'company', policy.policyId, policy.version, policy.text, expect.stringMatching(/^[a-f0-9]{64}$/)]);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining('UPDATE company_registration_invitations'), ['invite']);
  expect(users.save).toHaveBeenCalledWith(expect.objectContaining({ acceptedPrivacyAt: expect.any(Date) }));
  expect(links.save).toHaveBeenCalledWith({ userId: 'user', companyId: 'company' });
});
it('el contador obtiene un usuario adicional sin sustituir al responsable ni su correo', async () => {
  const { service, request, company, users, links, invitations } = setup();
  company.responsible = { name: 'Persona a cargo' };
  invitations.resolve.mockResolvedValue({ invitationId: 'accountant-invite', email: 'contador@example.com', company });
  await service.register(request);
  expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'contador', email: 'contador@example.com' }));
  expect(links.save).toHaveBeenCalledWith({ userId: 'user', companyId: 'company' });
  expect(company.registrationEmail).toBe('fixed@example.com');
  expect(company.responsible.name).toBe('Persona a cargo');
});
it('rechaza cambiar el destinatario y no consume el enlace', async () => {
  const { service, request, query, users } = setup();
  await expect(service.register({ ...request, email: 'other@example.com' })).rejects.toThrow('destinatario');
  expect(query).not.toHaveBeenCalled(); expect(users.save).not.toHaveBeenCalled();
});
it('ya no permite registro con código ni sin enlace', async () => {
  const { service, request, invitations } = setup();
  await expect(service.register({ ...request, registrationToken: '' })).rejects.toThrow('enlace');
  expect(invitations.resolve).not.toHaveBeenCalled();
});
it('no consume el enlace ni guarda usuario si falta la política vigente', async () => {
  const { service, request, query, users } = setup(IntegrationProvider.SIIGO);
  await expect(service.register({ ...request, acceptedIntegrationPolicyId: registrationPolicy([]).policyId })).rejects.toThrow('política vigente');
  expect(query).not.toHaveBeenCalled(); expect(users.save).not.toHaveBeenCalled();
});
it('una cuenta existente conserva su contraseña al vincular otra empresa', async () => {
  const { service, request, users } = setup();
  users.findOne.mockResolvedValue({ id: 'existing', email: 'fixed@example.com', password: 'existing-hash', active: true });
  await service.register(request);
  expect(bcrypt.compare).toHaveBeenCalledWith(request.password, 'existing-hash');
  expect(users.create).not.toHaveBeenCalled();
  expect(users.save).toHaveBeenCalledWith(expect.objectContaining({ password: 'existing-hash' }));
});
it('no permite sobrescribir una cuenta existente con otra contraseña', async () => {
  const { service, request, users, query } = setup();
  users.findOne.mockResolvedValue({ id: 'existing', password: 'existing-hash', active: true });
  jest.mocked(bcrypt.compare).mockImplementationOnce(async () => false);
  await expect(service.register(request)).rejects.toThrow('contraseña actual');
  expect(users.save).not.toHaveBeenCalled();
  expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE company_registration_invitations'))).toBe(false);
});
it('la consulta previa no consume el enlace', async () => {
  const { service, request, invitations, query } = setup();
  await expect(service.getRegistrationPolicy(request.registrationToken)).resolves.toEqual({ email: 'fixed@example.com' });
  expect(invitations.preview).toHaveBeenCalledWith(request.registrationToken);
  expect(query).not.toHaveBeenCalled();
});
it('respeta SIIGO prioritario e ignora integraciones inactivas', () => {
  const active = [{ provider: IntegrationProvider.JARVIS, active: true }, { provider: IntegrationProvider.SIIGO, active: true }];
  expect(registrationPolicy(active).policyId).toContain('siigo');
  expect(registrationPolicy([active[0], { ...active[1], active: false }]).policyId).toContain('jarvis');
  expect(() => assertRegistrationPolicy('unknown', active)).toThrow();
});
