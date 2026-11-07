import { RegistrationInvitationService } from './registration-invitation.service';
import { newRegistrationToken, registrationTokenHash } from '../helpers/company-registration.helper';
import { buildWelcomeEmail } from '../helpers/welcome-email.helper';
import { Company } from '../../company/entities/company.entity';
import { User } from '../entities/user.entity';
import { UserCompany } from '../entities/user-company.entity';
import { Integration } from '../../integration/entities/integration.entity';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';

function setup() {
  const company = { id: 'company', name: 'Empresa', integrations: [] };
  const repository = { findOne: jest.fn().mockResolvedValue(company), save: jest.fn().mockResolvedValue(company) };
  const query = jest.fn().mockResolvedValue([]);
  const manager = { query, getRepository: jest.fn(() => repository) };
  const db = { ...manager, transaction: jest.fn(async work => work(manager)) };
  const config = { get: jest.fn().mockReturnValue('https://jarvis.example') };
  const mail = { sendWelcome: jest.fn().mockResolvedValue(true) };
  const service = new RegistrationInvitationService(db as never, config as never, mail as never);
  return { service, repository, query, manager, db, config, mail };
}
it('envía enlace con token opaco y guarda únicamente el hash con vencimiento', async () => {
  const { service, query, mail } = setup();
  expect((await service.send('company', 'USER@example.com ', 'admin')).status).toBe('SENT');
  const url = new URL(mail.sendWelcome.mock.calls[0][2]);
  const token = url.searchParams.get('token')!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(mail.sendWelcome).toHaveBeenCalledWith('user@example.com', 'Empresa', expect.stringContaining('/registro?token='));
  const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))!;
  expect(insert[0]).toContain("interval '72 hours'");
  expect(insert[1]).toContain(registrationTokenHash(token));
  expect(JSON.stringify(query.mock.calls)).not.toContain(token);
  expect(query.mock.calls[0]).toEqual([expect.stringContaining('WHERE company_id=$1 AND email=$2 AND used_at IS NULL'), ['company', 'user@example.com']]);
});

function accountantSetup(provider = IntegrationProvider.JARVIS) {
  const company = { id: 'company', name: 'Empresa', registrationEmail: 'owner@example.com', responsible: { name: 'Persona a cargo' } };
  const companies = { findOne: jest.fn().mockResolvedValue(company), save: jest.fn() };
  const links = { findOne: jest.fn().mockImplementation(async ({ where }) => where.userId === 'owner' ? { userId: 'owner', companyId: 'company' } : null) };
  const users = { findOne: jest.fn().mockResolvedValue(null) };
  const integrations = { findOne: jest.fn().mockResolvedValue({ companyId: 'company', active: true, provider }) };
  const query = jest.fn().mockResolvedValue([]);
  const manager = { query, getRepository: jest.fn(entity => entity === Company ? companies : entity === UserCompany ? links : entity === User ? users : integrations) };
  const db = { ...manager, transaction: jest.fn(async work => work(manager)) };
  const mail = { sendWelcome: jest.fn().mockResolvedValue(true) };
  const service = new RegistrationInvitationService(db as never, { get: () => 'https://jarvis.example' } as never, mail as never);
  return { service, company, companies, links, users, integrations, query, db, mail };
}
it.each([IntegrationProvider.JARVIS, IntegrationProvider.SIIGO])('invita al contador en %s sin modificar el responsable ni invalidar otros destinatarios', async provider => {
  const { service, company, companies, links, integrations, query, mail } = accountantSetup(provider);
  await expect(service.inviteAccountant('owner', 'company', 'ACCOUNTANT@example.com')).resolves.toMatchObject({ status: 'SENT' });
  expect(links.findOne).toHaveBeenCalledWith({ where: { userId: 'owner', companyId: 'company' } });
  expect(integrations.findOne).toHaveBeenCalledWith({ where: expect.arrayContaining([{ companyId: 'company', active: true, provider }]) });
  expect(company.registrationEmail).toBe('owner@example.com');
  expect(company.responsible.name).toBe('Persona a cargo');
  expect(companies.save).not.toHaveBeenCalled();
  expect(query.mock.calls[0]).toEqual([expect.stringContaining('AND email=$2 AND used_at IS NULL'), ['company', 'accountant@example.com']]);
  expect(mail.sendWelcome).toHaveBeenCalledWith('accountant@example.com', 'Empresa', expect.stringContaining('/registro?token='));
});
it('rechaza invitar desde una empresa ajena o sin empresa activa', async () => {
  const { service, db, mail } = accountantSetup();
  await expect(service.inviteAccountant('intruder', 'company', 'accountant@example.com')).rejects.toThrow('No tienes acceso');
  await expect(service.inviteAccountant('owner', null, 'accountant@example.com')).rejects.toThrow('Selecciona una empresa');
  expect(db.transaction).not.toHaveBeenCalled(); expect(mail.sendWelcome).not.toHaveBeenCalled();
});
it('exige una integración activa de Siigo o Jarvis', async () => {
  const { service, integrations, mail } = accountantSetup(); integrations.findOne.mockResolvedValue(null);
  await expect(service.inviteAccountant('owner', 'company', 'accountant@example.com')).rejects.toThrow('integración activa');
  expect(mail.sendWelcome).not.toHaveBeenCalled();
});
it('avisa si el correo ya tiene acceso, sin reenviar ni cambiar su cuenta', async () => {
  const { service, users, links, db, mail } = accountantSetup();
  users.findOne.mockResolvedValue({ id: 'accountant' });
  links.findOne.mockResolvedValue({ userId: 'accountant', companyId: 'company' });
  await expect(service.inviteAccountant('owner', 'company', 'accountant@example.com')).rejects.toThrow('ya tiene acceso');
  expect(db.transaction).not.toHaveBeenCalled(); expect(mail.sendWelcome).not.toHaveBeenCalled();
});
it('una cuenta existente de otra empresa puede recibir la invitación', async () => {
  const { service, users, mail } = accountantSetup(); users.findOne.mockResolvedValue({ id: 'accountant' });
  await expect(service.inviteAccountant('owner', 'company', 'accountant@example.com')).resolves.toMatchObject({ status: 'SENT' });
  expect(mail.sendWelcome).toHaveBeenCalled();
});
it('al cambiar el destinatario principal revoca su enlace previo y conserva los de otros correos', async () => {
  const { service, query, companies } = accountantSetup();
  await service.send('company', 'newowner@example.com', 'admin');
  expect(query.mock.calls[0][1]).toEqual(['company', 'owner@example.com']);
  expect(query.mock.calls[1][1]).toEqual(['company', 'newowner@example.com']);
  expect(companies.save).toHaveBeenCalledWith(expect.objectContaining({ registrationEmail: 'newowner@example.com' }));
});
it('informa fallo de entrega sin fingir que se envió', async () => {
  const { service, mail } = setup(); mail.sendWelcome.mockResolvedValue(false);
  expect((await service.send('company', 'user@example.com', 'admin')).status).toBe('FAILED');
});
it('sin URL pública no genera invitación ni intenta enviar', async () => {
  const { service, config, query, mail } = setup(); config.get.mockReturnValue('');
  expect((await service.send('company', 'user@example.com', 'admin')).status).toBe('FAILED');
  expect(query).not.toHaveBeenCalled(); expect(mail.sendWelcome).not.toHaveBeenCalled();
});
it('rechaza enlaces vencidos, consumidos o inexistentes con el mismo mensaje', async () => {
  const { service } = setup();
  await expect(service.resolve(newRegistrationToken().token)).rejects.toThrow('no es válido');
  await expect(service.resolve('INVITE123')).rejects.toThrow('no es válido');
});
it('bloquea el enlace en la transacción de registro y filtra expiración y uso', async () => {
  const { service, query, manager } = setup();
  query.mockResolvedValue([{ id: 'invite', company_id: 'company', email: 'user@example.com' }]);
  await expect(service.resolve(newRegistrationToken().token, manager as never)).resolves.toMatchObject({ invitationId: 'invite', email: 'user@example.com' });
  expect(query.mock.calls[0][0]).toContain('used_at IS NULL AND expires_at > now() FOR UPDATE');
});
it('escapa el contenido dinámico del correo de bienvenida', () => {
  const email = buildWelcomeEmail('<Empresa & socios>', 'https://jarvis.example/registro?token=test&x="value"');
  expect(email.html).toContain('&lt;Empresa &amp; socios&gt;');
  expect(email.html).not.toContain('<Empresa & socios>');
  expect(email.html).toContain('72 horas');
  expect(email.text).toContain('https://jarvis.example/registro?token=');
});
