import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DataSource, In } from 'typeorm';
import { Company } from '../../company/entities/company.entity';
import { AppConfiguration } from '../../config/configuration';
import { Advisor } from '../entities/advisor.entity';
import { User } from '../entities/user.entity';
import { UserRole } from '../enums/user-role.enum';
import { advisorCommission } from '../helpers/advisor-commission.helper';
import { newRegistrationToken, registrationEmail, registrationTokenHash, REGISTRATION_LINK_ERROR } from '../helpers/company-registration.helper';
import { resolveAppPublicOrigin } from '../helpers/password-reset.helper';
import { applyPrivacyConsent, assertPrivacyPolicyAccepted } from '../helpers/privacy-policy.helper';
import { ResendMailService } from './resend-mail.service';

export interface AdvisorInput { name?: unknown; email?: unknown; commissionType?: unknown; commissionValue?: unknown; }

@Injectable()
export class AdvisorAccountService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService<AppConfiguration, true>, private readonly mail: ResendMailService) {}

  private name(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 120) throw new BadRequestException('Indica un nombre de hasta 120 caracteres.');
    return value.trim();
  }
  private dto(advisor: Advisor, clients: Pick<Company, 'id' | 'name' | 'nit'>[]) {
    return { id: advisor.id, name: advisor.user.name, email: advisor.user.email,
      commissionType: advisor.commissionType, commissionValue: advisor.commissionValue === null ? null : Number(advisor.commissionValue),
      registered: Boolean(advisor.registeredAt), active: advisor.user.active, lastDeliveryStatus: advisor.lastDeliveryStatus,
      lastInvitedAt: advisor.lastInvitedAt?.toISOString() ?? null, clients: clients.map(({ id, name, nit }) => ({ id, name, nit })) };
  }
  async list() {
    const advisors = await this.db.getRepository(Advisor).find({ relations: { user: true }, order: { createdAt: 'DESC' } });
    const clients = advisors.length ? await this.db.getRepository(Company).find({ where: { advisorId: In(advisors.map(item => item.id)) }, select: { id: true, name: true, nit: true, advisorId: true }, order: { name: 'ASC' } }) : [];
    return { items: advisors.map(item => this.dto(item, clients.filter(client => client.advisorId === item.id))) };
  }
  async get(id: string) {
    const advisor = await this.db.getRepository(Advisor).findOne({ where: { id }, relations: { user: true } });
    if (!advisor) throw new NotFoundException('Asesor no encontrado.');
    const clients = await this.db.getRepository(Company).find({ where: { advisorId: id }, select: { id: true, name: true, nit: true }, order: { name: 'ASC' } });
    return this.dto(advisor, clients);
  }
  async create(input: AdvisorInput) {
    const name = this.name(input?.name), email = registrationEmail(input?.email);
    const commission = advisorCommission(input?.commissionType ?? 'FIXED', input?.commissionValue);
    const password = await bcrypt.hash(randomBytes(32).toString('base64url'), 10);
    let id: string;
    try {
      id = await this.db.transaction(async manager => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`registration:${email}`]);
        const users = manager.getRepository(User);
        if (await users.findOne({ where: { email } })) throw new ConflictException('Ya existe una cuenta con este correo. Usa otro correo para crear el asesor.');
        const user = await users.save(users.create({ name, email, password, role: UserRole.ADVISOR, active: false }));
        const repository = manager.getRepository(Advisor);
        const advisor = await repository.save(repository.create({ userId: user.id, ...commission, registeredAt: null, lastDeliveryStatus: null, lastInvitedAt: null }));
        return advisor.id;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Ya existe una cuenta con este correo.');
      throw error;
    }
    const delivery = await this.sendAccess(id);
    return { advisor: await this.get(id), delivery };
  }
  async update(id: string, input: AdvisorInput) {
    const name = this.name(input?.name), commission = advisorCommission(input?.commissionType, input?.commissionValue);
    await this.db.transaction(async manager => {
      const repository = manager.getRepository(Advisor);
      const advisor = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!advisor) throw new NotFoundException('Asesor no encontrado.');
      await manager.getRepository(User).update({ id: advisor.userId, role: UserRole.ADVISOR }, { name });
      Object.assign(advisor, commission); await repository.save(advisor);
      await manager.getRepository(Company).update({ advisorId: id }, { commercial: name });
    });
    return { advisor: await this.get(id) };
  }
  async sendAccess(id: string) {
    const origin = resolveAppPublicOrigin(this.config.get('passwordResetMail.appPublicUrl', { infer: true }));
    if (!origin) {
      await this.db.getRepository(Advisor).update(id, { lastDeliveryStatus: 'FAILED' });
      return { status: 'FAILED' as const, message: 'El asesor está guardado, pero falta configurar el envío de acceso en el servidor.' };
    }
    const invitation = await this.db.transaction(async manager => {
      const repository = manager.getRepository(Advisor);
      const advisor = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!advisor) throw new NotFoundException('Asesor no encontrado.');
      const user = await manager.getRepository(User).findOneByOrFail({ id: advisor.userId, role: UserRole.ADVISOR });
      const registered = Boolean(advisor.registeredAt);
      const token = newRegistrationToken();
      if (!registered) {
        advisor.invitationHash = token.hash; advisor.invitationExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
        await repository.save(advisor);
      }
      return { user, registered, hash: registered ? null : token.hash, url: registered ? `${origin}/login` : `${origin}/registro/asesor?token=${encodeURIComponent(token.token)}` };
    });
    let sent = false;
    try { sent = await this.mail.sendAdvisorAccess(invitation.user.email, invitation.user.name, invitation.url, invitation.registered); } catch { /* Keep the account and allow an explicit retry. */ }
    await this.db.getRepository(Advisor).createQueryBuilder().update().set({ lastDeliveryStatus: sent ? 'SENT' : 'FAILED', ...(sent ? { lastInvitedAt: new Date() } : {}) })
      .where('id = :id', { id }).andWhere(invitation.registered ? 'registered_at IS NOT NULL' : 'invitation_hash = :hash', { hash: invitation.hash }).execute();
    return { status: sent ? 'SENT' as const : 'FAILED' as const, message: sent ? 'Correo de acceso enviado.' : 'El asesor está guardado, pero no se pudo enviar el correo. Puedes reenviarlo desde su registro.' };
  }
  async preview(token: unknown) {
    const hash = registrationTokenHash(token);
    const advisor = await this.db.getRepository(Advisor).createQueryBuilder('advisor').innerJoinAndSelect('advisor.user', 'user')
      .where('advisor.invitation_hash = :hash', { hash }).andWhere('advisor.invitation_expires_at > now()').andWhere('advisor.registered_at IS NULL').andWhere('user.role = :role', { role: UserRole.ADVISOR }).getOne();
    if (!advisor) throw new BadRequestException(REGISTRATION_LINK_ERROR);
    return { name: advisor.user.name, email: advisor.user.email };
  }
  async register(request: { registrationToken?: unknown; password?: unknown; acceptPrivacyPolicy?: unknown }) {
    const hash = registrationTokenHash(request?.registrationToken);
    assertPrivacyPolicyAccepted(request?.acceptPrivacyPolicy);
    if (typeof request?.password !== 'string' || request.password.length < 6 || request.password.length > 128) throw new BadRequestException('La contraseña debe tener entre 6 y 128 caracteres.');
    await this.preview(request.registrationToken);
    const password = await bcrypt.hash(request.password, 10);
    return this.db.transaction(async manager => {
      const repository = manager.getRepository(Advisor);
      const advisor = await repository.createQueryBuilder('advisor').addSelect(['advisor.invitationHash', 'advisor.invitationExpiresAt'])
        .where('advisor.invitation_hash = :hash', { hash }).andWhere('advisor.invitation_expires_at > now()').andWhere('advisor.registered_at IS NULL').setLock('pessimistic_write').getOne();
      if (!advisor) throw new BadRequestException(REGISTRATION_LINK_ERROR);
      const users = manager.getRepository(User);
      const user = await users.findOne({ where: { id: advisor.userId, role: UserRole.ADVISOR }, lock: { mode: 'pessimistic_write' } });
      if (!user || user.active) throw new BadRequestException(REGISTRATION_LINK_ERROR);
      user.password = password; user.passwordChangedAt = new Date(); user.active = true; applyPrivacyConsent(user);
      await users.save(user);
      advisor.registeredAt = new Date(); advisor.invitationHash = null; advisor.invitationExpiresAt = null; await repository.save(advisor);
      return user;
    });
  }
  async assignClient(id: string, companyId: string, remove = false) {
    await this.db.transaction(async manager => {
      const advisor = await manager.getRepository(Advisor).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!advisor) throw new NotFoundException('Asesor no encontrado.');
      const user = await manager.getRepository(User).findOneByOrFail({ id: advisor.userId, role: UserRole.ADVISOR });
      const repository = manager.getRepository(Company);
      const company = await repository.findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
      if (!company) throw new NotFoundException('Cliente no encontrado.');
      if ((remove && company.advisorId !== id) || (!remove && company.advisorId && company.advisorId !== id)) throw new ConflictException('El cliente está asignado a otro asesor. Actualiza la lista antes de cambiarlo.');
      company.advisorId = remove ? null : id; company.commercial = remove ? null : user.name; await repository.save(company);
    });
    return { advisor: await this.get(id) };
  }
}
