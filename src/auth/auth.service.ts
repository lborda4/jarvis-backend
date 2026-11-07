import { INTEGRATION_POLICIES } from './constants/integration-policies';
import { assertRegistrationPolicy } from './helpers/registration-policy.helper';
import { RegistrationInvitationService } from './services/registration-invitation.service';
import { registrationTokenHash } from './helpers/company-registration.helper';
import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { AppConfiguration } from '../config/configuration';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import { PlanSubscriptionService } from '../plan/plan-subscription.service';
import type { DocumentQuotaNotice } from '../plan/plan-subscription.service';
import { UserCompany } from './entities/user-company.entity';
import { User } from './entities/user.entity';
import {
  AuthMeResponseDto,
  AuthTokensResponseDto,
  LoginRequestDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
  RegisterRequestDto,
  SwitchCompanyRequestDto,
} from './dto/auth.dto';
import {
  buildAuthMeResponse,
  buildAuthTokensResponse,
} from './mappers/auth-response.mapper';
import { UsersRepository } from './repositories/users.repository';
import { UserCompaniesRepository } from './repositories/user-companies.repository';
import { AuthTokenPayload, AuthenticatedUser } from './interfaces/jwt-payload.interface';
import {
  AUTH_ERROR_CODE,
  AUTH_ERROR_MESSAGE,
} from './constants/auth-error.constants';
import { UserRole } from './enums/user-role.enum';
import { resolveActiveCompanyId } from './helpers/authenticated-company.helper';
import {
  applyPrivacyConsent,
  assertPrivacyPolicyAccepted,
} from './helpers/privacy-policy.helper';
import { isSessionIssuedBeforePasswordChange } from './helpers/password-reset.helper';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  async integrationPolicyAcceptance(userId: string, companyId: string | null | undefined, policyId: string, accept = false) {
    const policy = INTEGRATION_POLICIES[policyId];
    if (!companyId || !policy || !Object.prototype.hasOwnProperty.call(INTEGRATION_POLICIES, policyId)) throw new BadRequestException('No se pudo identificar la política o la empresa.');
    if (accept) {
      await this.dataSource.query(
        'INSERT INTO integration_policy_acceptances (user_id, company_id, policy_id, version, policy_text, policy_hash) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, company_id, policy_id) DO NOTHING',
        [userId, companyId, policyId, policy.version, policy.text, createHash('sha256').update(policy.text).digest('hex')],
      );
    }
    const rows = await this.dataSource.query('SELECT accepted_at FROM integration_policy_acceptances WHERE user_id=$1 AND company_id=$2 AND policy_id=$3', [userId, companyId, policyId]);
    return { accepted: rows.length > 0 };
  }

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly usersRepository: UsersRepository,
    private readonly userCompaniesRepository: UserCompaniesRepository,
    @Inject(forwardRef(() => PlanSubscriptionService))
    private readonly planSubscriptionService: PlanSubscriptionService,
    private readonly registrationInvitations: RegistrationInvitationService,
  ) {}

  async getRegistrationPolicy(token: unknown) {
    return this.registrationInvitations.preview(token);
  }

  async inviteAccountant(currentUser: AuthenticatedUser, email: unknown) {
    return this.registrationInvitations.inviteAccountant(currentUser.userId, currentUser.companyId, email);
  }

  async register(request: RegisterRequestDto): Promise<AuthTokensResponseDto> {
    const password = request?.password ?? '';
    registrationTokenHash(request?.registrationToken);
    if (typeof password !== 'string' || password.length < 6 || password.length > 128)
      throw new BadRequestException('La contraseña debe tener entre 6 y 128 caracteres.');
    assertPrivacyPolicyAccepted(request?.acceptPrivacyPolicy);

    const { user, company } = await this.dataSource.transaction(
      async (manager) => {
        const usersRepository = manager.getRepository(User);
        const userCompaniesRepository = manager.getRepository(UserCompany);
        const { invitationId, email, company } = await this.registrationInvitations.resolve(request.registrationToken, manager);
        if (request.email !== undefined && (typeof request.email !== 'string' || request.email.trim().toLowerCase() !== email))
          throw new BadRequestException('El correo debe coincidir con el destinatario del enlace.');
        const acceptedPolicy = assertRegistrationPolicy(request.acceptedIntegrationPolicyId, company.integrations);
        // Serialize account creation when different company invitations target the same email.
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`registration:${email}`]);
        const existingUser = await usersRepository.findOne({ where: { email } });
        if (existingUser && (!existingUser.active || !await bcrypt.compare(password, existingUser.password)))
          throw new ConflictException('Ya existe una cuenta con este correo. Usa su contraseña actual para vincular esta empresa.');
        const passwordHash = existingUser?.password ?? await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

        const user =
          existingUser ??
          usersRepository.create({
            name: company.registrationEmail && company.registrationEmail !== email
              ? email.split('@')[0]
              : company.responsible?.name?.trim() || company.name,
            email,
            password: passwordHash,
            active: true,
          });

        applyPrivacyConsent(user);
        await usersRepository.save(user);

        const existingLink = await userCompaniesRepository.findOne({
          where: {
            userId: user.id,
            companyId: company.id,
          },
        });

        if (existingLink) {
          throw new ConflictException({
            message: AUTH_ERROR_MESSAGE.USER_ALREADY_LINKED_TO_COMPANY,
            code: AUTH_ERROR_CODE.USER_ALREADY_LINKED_TO_COMPANY,
          });
        }

        await userCompaniesRepository.save(
          userCompaniesRepository.create({
            userId: user.id,
            companyId: company.id,
          }),
        );

        if (acceptedPolicy) {
          await manager.query(
            'INSERT INTO integration_policy_acceptances (user_id, company_id, policy_id, version, policy_text, policy_hash) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id, company_id, policy_id) DO NOTHING',
            [user.id, company.id, acceptedPolicy.policyId, acceptedPolicy.version, acceptedPolicy.text, createHash('sha256').update(acceptedPolicy.text).digest('hex')],
          );
        }
        await manager.query('UPDATE company_registration_invitations SET used_at=now() WHERE id=$1 AND used_at IS NULL', [invitationId]);

        return {
          user,
          company,
        };
      },
    );

    return this.buildAuthResponse(user, company);
  }

  async login(request: LoginRequestDto): Promise<AuthTokensResponseDto> {
    const email = request?.email?.trim().toLowerCase();
    const password = request?.password ?? '';

    if (!email || !password) {
      throw new BadRequestException('Email y contraseña son obligatorios.');
    }

    const user = await this.usersRepository.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException({
        message: AUTH_ERROR_MESSAGE.ACCOUNT_NOT_FOUND,
        code: AUTH_ERROR_CODE.ACCOUNT_NOT_FOUND,
      });
    }

    if (!user.active) {
      throw new UnauthorizedException({
        message: AUTH_ERROR_MESSAGE.ACCOUNT_INACTIVE,
        code: AUTH_ERROR_CODE.ACCOUNT_INACTIVE,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      throw new UnauthorizedException({
        message: AUTH_ERROR_MESSAGE.INVALID_PASSWORD,
        code: AUTH_ERROR_CODE.INVALID_PASSWORD,
      });
    }

    const company = await this.resolveActiveCompanyForUser(user);

    return this.buildAuthResponse(user, company);
  }

  async switchCompany(
    currentUser: AuthenticatedUser,
    request: SwitchCompanyRequestDto,
  ): Promise<AuthTokensResponseDto> {
    const companyId = request?.companyId?.trim();

    if (!companyId) {
      throw new BadRequestException('El companyId es obligatorio.');
    }

    const user = await this.usersRepository.findById(currentUser.userId);

    if (!user?.active) {
      throw new UnauthorizedException('Usuario inactivo o no encontrado.');
    }

    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        user.id,
        companyId,
      );

    if (!userCompany?.company) {
      throw new UnauthorizedException({
        message: AUTH_ERROR_MESSAGE.COMPANY_NOT_LINKED,
        code: AUTH_ERROR_CODE.COMPANY_NOT_LINKED,
      });
    }

    return this.buildAuthResponse(user, userCompany.company);
  }

  async refresh(
    request: RefreshTokenRequestDto,
  ): Promise<RefreshTokenResponseDto> {
    const refreshToken = request?.refreshToken?.trim();

    if (!refreshToken) {
      throw new BadRequestException('El refreshToken es obligatorio.');
    }

    let payload: AuthTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AuthTokenPayload>(refreshToken, {
        secret: this.configService.get('jwt.refreshSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token inválido.');
    }

    const user = await this.usersRepository.findById(payload.sub);

    if (!user?.active) {
      throw new UnauthorizedException('Usuario inactivo o no encontrado.');
    }

    if (
      isSessionIssuedBeforePasswordChange(user.passwordChangedAt, payload.iat)
    ) {
      throw new UnauthorizedException('La sesión expiró. Vuelve a iniciar sesión.');
    }

    const companyId = resolveActiveCompanyId(
      payload.companyId,
      user.role,
      'El token no contiene una empresa activa válida.',
    );

    if (!companyId) {
      const tokens = await this.generateTokens(user, null);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    }

    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        user.id,
        companyId,
      );

    if (!userCompany?.company) {
      throw new UnauthorizedException(
        'La empresa activa del token no está asociada al usuario.',
      );
    }

    const tokens = await this.generateTokens(user, userCompany.companyId);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async getMe(currentUser: AuthenticatedUser): Promise<AuthMeResponseDto> {
    const user = await this.usersRepository.findById(currentUser.userId);

    if (!user?.active) {
      throw new UnauthorizedException('Usuario inactivo o no encontrado.');
    }

    const companies = await this.listCompaniesForUser(user.id);
    const companyId = resolveActiveCompanyId(
      currentUser.companyId,
      user.role,
      'La empresa activa no está asociada al usuario.',
    );

    if (!companyId) {
      return buildAuthMeResponse(user, null, companies, null);
    }

    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        currentUser.userId,
        companyId,
      );

    if (!userCompany?.company) {
      throw new UnauthorizedException(
        'La empresa activa no está asociada al usuario.',
      );
    }

    return buildAuthMeResponse(
      user,
      userCompany.company,
      companies,
      await this.resolveJarvisQuotaNotice(userCompany.company.id),
    );
  }

  private async buildAuthResponse(
    user: User,
    company: Company | null,
  ): Promise<AuthTokensResponseDto> {
    const tokens = await this.generateTokens(user, company?.id ?? null);
    const companies = await this.listCompaniesForUser(user.id);

    return buildAuthTokensResponse(
      tokens.accessToken,
      tokens.refreshToken,
      user,
      company,
      companies,
      await this.resolveJarvisQuotaNotice(company?.id),
    );
  }

  private async resolveJarvisQuotaNotice(
    companyId?: string | null,
  ): Promise<DocumentQuotaNotice | null> {
    const trimmed = companyId?.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const subscription = await this.planSubscriptionService.getSubscription(
        trimmed,
        IntegrationProvider.JARVIS,
      );
      return subscription.quotaNotice ?? null;
    } catch {
      return null;
    }
  }

  private async listCompaniesForUser(userId: string): Promise<Company[]> {
    const links = await this.userCompaniesRepository.findAllByUserId(userId);

    return links
      .map((link) => link.company)
      .filter((company): company is Company => Boolean(company));
  }

  private async resolveActiveCompanyForUser(
    user: User,
  ): Promise<Company | null> {
    const companies = await this.listCompaniesForUser(user.id);

    if (companies.length === 0) {
      if (user.role === UserRole.ADMIN) {
        return null;
      }

      throw new UnauthorizedException({
        message: AUTH_ERROR_MESSAGE.NO_ACTIVE_COMPANY,
        code: AUTH_ERROR_CODE.NO_ACTIVE_COMPANY,
      });
    }

    return companies[0];
  }

  private async generateTokens(
    user: User,
    companyId: string | null,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      companyId: companyId ?? null,
      type: 'access',
    };
    const refreshPayload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      companyId: companyId ?? null,
      type: 'refresh',
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        expiresIn: this.configService.get('jwt.accessExpiresIn', {
          infer: true,
        }) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.get('jwt.refreshSecret', { infer: true }),
        expiresIn: this.configService.get('jwt.refreshExpiresIn', {
          infer: true,
        }) as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
    ]);

    return { accessToken, refreshToken };
  }

}
