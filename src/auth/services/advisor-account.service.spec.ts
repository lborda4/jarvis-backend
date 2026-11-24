import { AdvisorAccountService } from './advisor-account.service';
import { Advisor } from '../entities/advisor.entity';
import { User } from '../entities/user.entity';
import { Company } from '../../company/entities/company.entity';
import { UserRole } from '../enums/user-role.enum';
import { registrationTokenHash } from '../helpers/company-registration.helper';
import * as bcrypt from 'bcrypt';

function setup() {
  const users: User[] = [], advisors: Advisor[] = [], companies: Company[] = [];
  let insideTransaction = false;
  const events: string[] = [];
  const repository = <T extends { id: string }>(rows: T[], kind: string) => {
    const matches = (row: T, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => {
      const actual = (row as Record<string, unknown>)[key];
      return value && typeof value === 'object' && '_value' in value ? (value._value as unknown[]).includes(actual) : actual === value;
    });
    const hydrate = (row: T | undefined) => {
      if (kind === 'advisor' && row) (row as unknown as Advisor).user = users.find(user => user.id === (row as unknown as Advisor).userId)!;
      return row ?? null;
    };
    const repo = {
      create: jest.fn((input: Partial<T>) => ({ id: `${kind}-${rows.length + 1}`, ...input } as T)),
      save: jest.fn(async (row: T) => { if (!rows.includes(row)) rows.push(row); return row; }),
      find: jest.fn(async (options: { where?: Record<string, unknown> } = {}) => rows.filter(row => !options.where || matches(row, options.where)).map(hydrate)),
      findOne: jest.fn(async ({ where, lock }: { where: Record<string, unknown>; lock?: unknown }) => { if (lock) events.push(`lock:${kind}`); return hydrate(rows.find(row => matches(row, where))); }),
      findOneByOrFail: jest.fn(async (where: Record<string, unknown>) => { const row = rows.find(item => matches(item, where)); if (!row) throw Error('Not found'); return hydrate(row); }),
      update: jest.fn(async (where: string | Record<string, unknown>, patch: Partial<T>) => { rows.filter(row => typeof where === 'string' ? row.id === where : matches(row, where)).forEach(row => Object.assign(row, patch)); }),
      createQueryBuilder: jest.fn(() => {
        let hash: string | undefined, id: string | undefined, patch: Partial<T>;
        const qb = {
          innerJoinAndSelect: jest.fn(() => qb), addSelect: jest.fn(() => qb), setLock: jest.fn(() => qb),
          where: jest.fn((_sql: string, params?: { hash?: string; id?: string }) => { hash = params?.hash; id = params?.id; return qb; }),
          andWhere: jest.fn((_sql: string, params?: { hash?: string }) => { if (params?.hash) hash = params.hash; return qb; }),
          update: jest.fn(() => qb), set: jest.fn((value: Partial<T>) => { patch = value; return qb; }),
          execute: jest.fn(async () => { rows.filter(row => row.id === id && (!hash || (row as unknown as Advisor).invitationHash === hash)).forEach(row => Object.assign(row, patch)); }),
          getOne: jest.fn(async () => hydrate(rows.find(row => {
            const advisor = row as unknown as Advisor;
            return advisor.invitationHash === hash && !advisor.registeredAt && (advisor.invitationExpiresAt?.getTime() ?? 0) > Date.now();
          }))),
        };
        return qb;
      }),
    };
    return repo;
  };
  const userRepo = repository(users, 'user'), advisorRepo = repository(advisors, 'advisor'), companyRepo = repository(companies, 'company');
  const manager = { query: jest.fn(), getRepository: jest.fn(entity => {
    if (entity === User) return userRepo;
    if (entity === Advisor) return advisorRepo;
    if (entity === Company) return companyRepo;
    throw Error('Unexpected repository: advisor must not receive company access');
  }) };
  const db = { ...manager, transaction: jest.fn(async work => { insideTransaction = true; try { return await work(manager); } finally { insideTransaction = false; } }) };
  const config = { get: jest.fn(() => 'https://jarvis.example') };
  const mail = { sendAdvisorAccess: jest.fn(async (_email: string, _name: string, _url: string, _registered: boolean) => { expect(insideTransaction).toBe(false); return true; }) };
  const service = new AdvisorAccountService(db as never, config as never, mail as never);
  const token = () => new URL(mail.sendAdvisorAccess.mock.calls.at(-1)![2]).searchParams.get('token')!;
  const create = () => service.create({ name: ' Laura ', email: ' LAURA@example.com ', commissionType: 'PERCENT', commissionValue: 12.5 });
  return { service, users, advisors, companies, userRepo, advisorRepo, companyRepo, db, mail, config, token, create, events };
}

it('creates an inactive advisor, stores only the invitation hash and exposes a safe profile', async () => {
  const f = setup(); const result = await f.create();
  expect(result.advisor).toMatchObject({ name: 'Laura', email: 'laura@example.com', commissionType: 'PERCENT', commissionValue: 12.5, registered: false, active: false, clients: [] });
  expect(f.users[0]).toMatchObject({ role: UserRole.ADVISOR, active: false });
  expect(f.users[0].password).toMatch(/^\$2/);
  expect(f.advisors[0].invitationHash).toBe(registrationTokenHash(f.token()));
  expect(f.advisors[0].invitationExpiresAt!.getTime() - Date.now()).toBeGreaterThan(71 * 3600000);
  expect(JSON.stringify(result)).not.toContain(f.token());
  expect(JSON.stringify(result)).not.toContain('password');
  expect(JSON.stringify(result)).not.toContain('invitationHash');
  expect(f.db.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), ['registration:laura@example.com']);
});

it('rejects existing emails without converting the existing account or sending mail', async () => {
  const f = setup(); f.users.push({ id: 'existing', email: 'laura@example.com', role: UserRole.ADMIN } as User);
  await expect(f.create()).rejects.toThrow('Ya existe una cuenta');
  expect(f.users[0].role).toBe(UserRole.ADMIN); expect(f.advisors).toHaveLength(0); expect(f.mail.sendAdvisorAccess).not.toHaveBeenCalled();
});

it('retains the advisor when delivery fails and supports an explicit retry', async () => {
  const f = setup(); f.mail.sendAdvisorAccess.mockResolvedValueOnce(false);
  const result = await f.create(); expect(result.delivery.status).toBe('FAILED'); expect(result.advisor.lastDeliveryStatus).toBe('FAILED');
  await expect(f.service.sendAccess(result.advisor.id)).resolves.toMatchObject({ status: 'SENT' });
  expect(f.advisors).toHaveLength(1); expect(f.users).toHaveLength(1);
});

it('rotates pending links and accepts registration once, with privacy consent and a hashed password', async () => {
  const f = setup(); const { advisor } = await f.create(); const old = f.token();
  await f.service.sendAccess(advisor.id); const current = f.token();
  expect(current).not.toBe(old); await expect(f.service.preview(old)).rejects.toThrow('no es válido');
  await expect(f.service.preview(current)).resolves.toEqual({ name: 'Laura', email: 'laura@example.com' });
  await expect(f.service.register({ registrationToken: current, password: 'password123', acceptPrivacyPolicy: false })).rejects.toThrow();
  expect(f.users[0].active).toBe(false);
  const user = await f.service.register({ registrationToken: current, password: 'password123', acceptPrivacyPolicy: true });
  expect(user.active).toBe(true); expect(user.acceptedPrivacyAt).toBeInstanceOf(Date); expect(user.privacyPolicyVersion).toBeTruthy();
  expect(await bcrypt.compare('password123', user.password)).toBe(true);
  expect(f.advisors[0]).toMatchObject({ invitationHash: null, invitationExpiresAt: null, registeredAt: expect.any(Date) });
  await expect(f.service.register({ registrationToken: current, password: 'another123', acceptPrivacyPolicy: true })).rejects.toThrow('no es válido');
  const stored = user.password; await f.service.sendAccess(advisor.id);
  expect(f.mail.sendAdvisorAccess).toHaveBeenLastCalledWith('laura@example.com', 'Laura', 'https://jarvis.example/login', true);
  expect(user.password).toBe(stored);
});

it('rejects expired or malformed links without activating an account', async () => {
  const f = setup(); await f.create(); const token = f.token(); f.advisors[0].invitationExpiresAt = new Date(Date.now() - 1);
  await expect(f.service.preview(token)).rejects.toThrow('no es válido');
  await expect(f.service.register({ registrationToken: token, password: 'password123', acceptPrivacyPolicy: true })).rejects.toThrow('no es válido');
  await expect(f.service.preview('not-a-token')).rejects.toThrow('no es válido'); expect(f.users[0].active).toBe(false);
});

it('assigns clients by advisor id, preserves ownership and updates linked names on advisor edits', async () => {
  const f = setup(); const { advisor } = await f.create();
  f.companies.push({ id: 'client', name: 'Empresa', nit: '900', advisorId: null } as Company);
  const result = await f.service.assignClient(advisor.id, 'client');
  expect(result.advisor.clients).toEqual([{ id: 'client', name: 'Empresa', nit: '900' }]);
  expect(f.companies[0]).toMatchObject({ advisorId: advisor.id, commercial: 'Laura' });
  expect(f.events.slice(-2)).toEqual(['lock:advisor', 'lock:company']);
  await f.service.update(advisor.id, { name: 'Laura Gómez', commissionType: 'FIXED', commissionValue: 40000 });
  expect(f.companies[0].commercial).toBe('Laura Gómez'); expect(f.advisors[0].commissionValue).toBe('40000.00');
  f.companies[0].advisorId = 'other'; await expect(f.service.assignClient(advisor.id, 'client')).rejects.toThrow('otro asesor');
  await expect(f.service.assignClient(advisor.id, 'client', true)).rejects.toThrow('otro asesor');
  f.companies[0].advisorId = advisor.id; await f.service.assignClient(advisor.id, 'client', true);
  expect(f.companies[0]).toMatchObject({ advisorId: null, commercial: null });
});

function addExistingUser(f: ReturnType<typeof setup>, patch: Partial<User> = {}) {
  const user = { id: 'existing-user', email: 'existing@example.com', name: 'Usuario existente', role: UserRole.USER,
    active: true, password: 'existing-password-hash', acceptedPrivacyAt: new Date('2026-01-01'), privacyPolicyVersion: 'existing-policy', ...patch } as User;
  f.users.push(user);
  return user;
}

it('finds an existing account by normalized email without exposing passwords or changing it', async () => {
  const f = setup(); const user = addExistingUser(f);
  await expect(f.service.lookupExistingUser(' EXISTING@example.com ')).resolves.toEqual({ user: {
    id: user.id, name: user.name, email: user.email, role: UserRole.USER, active: true, advisorId: null, canConvert: true, reason: null,
  } });
  expect(f.users[0].role).toBe(UserRole.USER);
  expect(f.mail.sendAdvisorAccess).not.toHaveBeenCalled();
  await expect(f.service.lookupExistingUser('missing@example.com')).rejects.toThrow('No se encontró');
  await expect(f.service.lookupExistingUser('invalid')).rejects.toThrow();
});

it('converts an active existing account without changing its password, consent or company links and without email', async () => {
  const f = setup(); const user = addExistingUser(f);
  const password = user.password, consent = user.acceptedPrivacyAt;
  f.companies.push({ id: 'unchanged-company', advisorId: null, commercial: null } as Company);
  const result = await f.service.convertExistingUser(user.id);
  expect(result.changed).toBe(true);
  expect(result.advisor).toMatchObject({ name: user.name, email: user.email, active: true, registered: true, commissionValue: null, clients: [] });
  expect(user).toMatchObject({ role: UserRole.ADVISOR, password, acceptedPrivacyAt: consent, privacyPolicyVersion: 'existing-policy', active: true });
  expect(f.users).toHaveLength(1); expect(f.advisors).toHaveLength(1);
  expect(f.events).toEqual(['lock:user', 'lock:advisor']);
  expect(f.companyRepo.update).not.toHaveBeenCalled();
  expect(f.mail.sendAdvisorAccess).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toMatch(/password|invitationHash/);
});

it('restores the original advisor profile and retains its client assignments, commission and registration date', async () => {
  const f = setup(); const user = addExistingUser(f);
  const registeredAt = new Date('2026-02-01');
  f.advisors.push({ id: 'old-advisor', userId: user.id, registeredAt, commissionType: 'PERCENT', commissionValue: '12.50', lastDeliveryStatus: 'SENT', invitationHash: null, invitationExpiresAt: null } as Advisor);
  f.companies.push({ id: 'old-client', name: 'Cliente anterior', nit: '900', advisorId: 'old-advisor', commercial: user.name } as Company);
  const result = await f.service.convertExistingUser(user.id);
  expect(result).toMatchObject({ changed: true, advisor: { id: 'old-advisor', commissionType: 'PERCENT', commissionValue: 12.5, clients: [{ id: 'old-client' }] } });
  expect(f.advisors[0].registeredAt).toBe(registeredAt);
  expect(f.advisors).toHaveLength(1); expect(f.advisorRepo.save).not.toHaveBeenCalled();
  expect(f.companies[0].advisorId).toBe('old-advisor');
});

it('is idempotent on retries and reports accounts already registered as advisors', async () => {
  const f = setup(); const user = addExistingUser(f);
  const first = await f.service.convertExistingUser(user.id);
  const again = await f.service.convertExistingUser(user.id);
  expect(again.changed).toBe(false); expect(again.advisor.id).toBe(first.advisor.id);
  expect(f.advisors).toHaveLength(1); expect(f.userRepo.update).toHaveBeenCalledTimes(1);
  expect((await f.service.lookupExistingUser(user.email)).user).toMatchObject({ canConvert: false, advisorId: first.advisor.id, reason: 'El usuario ya es comercial.' });
});

it.each([
  { role: UserRole.ADMIN, active: true },
  { role: UserRole.USER, active: false },
  { role: UserRole.ADVISOR, active: false },
])('rejects unsafe or inactive conversion targets: %j', async patch => {
  const f = setup(); const user = addExistingUser(f, patch);
  expect((await f.service.lookupExistingUser(user.email)).user.canConvert).toBe(false);
  await expect(f.service.convertExistingUser(user.id)).rejects.toThrow();
  expect(user.role).toBe(patch.role); expect(user.active).toBe(patch.active);
  expect(f.advisors).toHaveLength(0); expect(f.userRepo.update).not.toHaveBeenCalled();
  expect(f.mail.sendAdvisorAccess).not.toHaveBeenCalled();
});

it('completes only the commercial profile for an already active account and invalidates pending invitations', async () => {
  const f = setup(); const user = addExistingUser(f);
  f.advisors.push({ id: 'old-pending', userId: user.id, registeredAt: null, commissionType: 'FIXED', commissionValue: '40000.00', invitationHash: 'old-invite', invitationExpiresAt: new Date(), lastDeliveryStatus: 'FAILED' } as Advisor);
  const result = await f.service.convertExistingUser(user.id);
  expect(result.advisor).toMatchObject({ id: 'old-pending', registered: true, active: true, commissionValue: 40000, lastDeliveryStatus: null });
  expect(f.advisors[0]).toMatchObject({ invitationHash: null, invitationExpiresAt: null });
  expect(f.users[0].password).toBe('existing-password-hash');
});

it('does not create a profile for a missing user id', async () => {
  const f = setup();
  await expect(f.service.convertExistingUser('missing')).rejects.toThrow('Usuario no encontrado');
  expect(f.advisors).toHaveLength(0);
});
