import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppConfiguration } from '../../config/configuration';
import { Company } from '../../company/entities/company.entity';
import { User } from '../entities/user.entity';
import { UserCompany } from '../entities/user-company.entity';
import { Integration } from '../../integration/entities/integration.entity';
import { IntegrationProvider } from '../../integration/enums/integration-provider.enum';
import { registrationPolicy } from '../helpers/registration-policy.helper';
import { newRegistrationToken, registrationTokenHash, registrationEmail, REGISTRATION_LINK_ERROR } from '../helpers/company-registration.helper';
import { resolveAppPublicOrigin } from '../helpers/password-reset.helper';
import { ResendMailService } from './resend-mail.service';

export type WelcomeDelivery = { status: 'SENT' | 'FAILED'; message: string };

@Injectable()
export class RegistrationInvitationService {
  private readonly logger = new Logger(RegistrationInvitationService.name);
  constructor(private readonly db: DataSource, private readonly config: ConfigService<AppConfiguration, true>, private readonly mail: ResendMailService) {}

  async send(companyId: string, emailValue: unknown, actor: string): Promise<WelcomeDelivery> {
    return this.sendInvitation(companyId, emailValue, actor, true);
  }

  async inviteAccountant(actor: string, companyId: string | null | undefined, emailValue: unknown): Promise<WelcomeDelivery> {
    if (!companyId) throw new ForbiddenException('Selecciona una empresa para invitar al contador.');
    const links = this.db.getRepository(UserCompany);
    if (!await links.findOne({ where: { userId: actor, companyId } }))
      throw new ForbiddenException('No tienes acceso a esta empresa.');
    const integration = await this.db.getRepository(Integration).findOne({ where: [
      { companyId, active: true, provider: IntegrationProvider.SIIGO },
      { companyId, active: true, provider: IntegrationProvider.JARVIS },
    ] });
    if (!integration) throw new ForbiddenException('Esta empresa necesita una integración activa de Siigo o Jarvis.');
    const email = registrationEmail(emailValue);
    const existing = await this.db.getRepository(User).findOne({ where: { email } });
    if (existing && await links.findOne({ where: { userId: existing.id, companyId } }))
      throw new BadRequestException('Este correo ya tiene acceso a la empresa. Puede iniciar sesión con su contraseña actual.');
    return this.sendInvitation(companyId, email, actor, false);
  }

  private async sendInvitation(companyId: string, emailValue: unknown, actor: string, primary: boolean): Promise<WelcomeDelivery> {
    const email = registrationEmail(emailValue);
    const origin = resolveAppPublicOrigin(this.config.get('passwordResetMail.appPublicUrl', { infer: true }));
    if (!origin) return { status: 'FAILED', message: 'La empresa está creada, pero falta APP_PUBLIC_URL en el servidor para enviar la bienvenida.' };
    try {
      const { token, hash } = newRegistrationToken();
      const company = await this.db.transaction(async manager => {
        const repository = manager.getRepository(Company);
        const company = await repository.findOne({ where: { id: companyId }, lock: { mode: 'pessimistic_write' } });
        if (!company) throw new BadRequestException('Empresa no encontrada.');
        if (primary && company.registrationEmail && company.registrationEmail !== email) {
          await manager.query('UPDATE company_registration_invitations SET used_at=now() WHERE company_id=$1 AND email=$2 AND used_at IS NULL', [companyId, company.registrationEmail]);
        }
        await manager.query('UPDATE company_registration_invitations SET used_at=now() WHERE company_id=$1 AND email=$2 AND used_at IS NULL', [companyId, email]);
        await manager.query("INSERT INTO company_registration_invitations (id, company_id, email, token_hash, expires_at, created_by_user_id) VALUES ($1,$2,$3,$4,now() + interval '72 hours',$5)", [randomUUID(), companyId, email, hash, actor]);
        if (primary) {
          company.registrationEmail = email;
          await repository.save(company);
        }
        return company;
      });
      const sent = await this.mail.sendWelcome(email, company.name, `${origin}/registro?token=${encodeURIComponent(token)}`);
      return sent ? { status: 'SENT', message: 'Correo de bienvenida enviado. El enlace es válido durante 72 horas.' }
        : { status: 'FAILED', message: 'La empresa está creada, pero no se pudo enviar el correo. Revisa Resend y vuelve a enviar la bienvenida.' };
    } catch {
      this.logger.warn('No se pudo preparar o enviar el correo de bienvenida.');
      return { status: 'FAILED', message: 'La empresa está creada, pero no se pudo enviar la bienvenida. Intenta reenviarla desde Administración.' };
    }
  }

  async resolve(token: unknown, manager?: EntityManager): Promise<{ invitationId: string; email: string; company: Company }> {
    const hash = registrationTokenHash(token);
    const executor = manager ?? this.db;
    const rows = await executor.query(`SELECT id, company_id, email FROM company_registration_invitations WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()${manager ? ' FOR UPDATE' : ''}`, [hash]);
    const row = rows[0] as { id: string; company_id: string; email: string } | undefined;
    if (!row) throw new BadRequestException(REGISTRATION_LINK_ERROR);
    const company = await executor.getRepository(Company).findOne({ where: { id: row.company_id }, relations: { integrations: true } });
    if (!company) throw new BadRequestException(REGISTRATION_LINK_ERROR);
    return { invitationId: row.id, email: row.email, company };
  }

  async preview(token: unknown) {
    const { company, email } = await this.resolve(token);
    const policy = registrationPolicy(company.integrations);
    const existing = await this.db.getRepository(User).findOne({ where: { email }, select: { id: true } });
    return { companyId: company.id, companyName: company.name, email, existingAccount: Boolean(existing), policyId: policy.policyId, version: policy.version };
  }
}
