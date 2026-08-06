import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { CompanyPersonType } from '../company/enums/company-person-type.enum';
import type { CompanyResponsible } from '../company/interfaces/company-responsible.interface';
import { IntegrationProvider } from '../integration/enums/integration-provider.enum';
import {
  ensureJarvisIntegration,
  ensureSiigoIntegration,
} from '../integration/helpers/integration-setup.helper';
import { buildJarvisCredentialsSeed } from '../integration/jarvis/helpers/jarvis-credentials.helper';
import { AppConfiguration } from '../config/configuration';
import { UserCompany } from './entities/user-company.entity';
import { User } from './entities/user.entity';
import { JarvisCredentialsSeedDto } from '../integration/jarvis/dto/jarvis-credentials-seed.dto';
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

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly usersRepository: UsersRepository,
    private readonly userCompaniesRepository: UserCompaniesRepository,
  ) {}

  async register(request: RegisterRequestDto): Promise<AuthTokensResponseDto> {
    const name = request?.name?.trim();
    const email = request?.email?.trim().toLowerCase();
    const password = request?.password ?? '';
    const companyName = request?.company?.name?.trim();
    const companyNit = this.normalizeNit(request?.company?.nit);
    const companyPersonType = this.normalizeCompanyPersonType(
      request?.company?.personType,
    );
    const companyProvider = this.normalizeIntegrationProvider(
      request?.company?.provider,
    );
    const companyResponsible = this.normalizeResponsible(
      request?.company?.responsible,
    );

    this.validateRegisterInput(
      name,
      email,
      password,
      companyName,
      companyNit,
      companyPersonType,
      companyProvider,
      companyResponsible,
    );

    const existingUser = await this.usersRepository.findByEmail(email);

    if (existingUser) {
      const passwordMatches = await bcrypt.compare(
        password,
        existingUser.password,
      );

      if (!passwordMatches) {
        throw new ConflictException('Ya existe un usuario con ese email.');
      }
    }

    const passwordHash = existingUser
      ? existingUser.password
      : await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const { user, company } = await this.dataSource.transaction(
      async (manager) => {
        const usersRepository = manager.getRepository(User);
        const companiesRepository = manager.getRepository(Company);
        const userCompaniesRepository = manager.getRepository(UserCompany);

        const user =
          existingUser ??
          (await usersRepository.save(
            usersRepository.create({
              name,
              email,
              password: passwordHash,
              active: true,
            }),
          ));

        let company = await companiesRepository.findOne({
          where: { nit: companyNit },
        });

        if (!company) {
          company = await companiesRepository.save(
            companiesRepository.create({
              name: companyName,
              nit: companyNit,
              personType: companyPersonType,
              responsible: companyResponsible,
            }),
          );

          try {
            if (companyProvider === IntegrationProvider.JARVIS) {
              const jarvisCredentials = this.normalizeJarvisCredentialsSeed(
                request?.company?.jarvisCredentials,
              );

              await ensureJarvisIntegration(
                manager,
                company.id,
                jarvisCredentials ?? {},
              );
            } else {
              await ensureSiigoIntegration(manager, company.id);
            }
          } catch (error) {
            throw new BadRequestException(
              error instanceof Error
                ? error.message
                : `No se pudo configurar la integración ${companyProvider}.`,
            );
          }
        }

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

    const company = await this.resolveActiveCompanyForUser(user.id);

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

    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        user.id,
        payload.companyId,
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

    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        currentUser.userId,
        currentUser.companyId,
      );

    if (!userCompany?.company) {
      throw new UnauthorizedException(
        'La empresa activa no está asociada al usuario.',
      );
    }

    return buildAuthMeResponse(
      user,
      userCompany.company,
      await this.listCompaniesForUser(user.id),
    );
  }

  private async buildAuthResponse(
    user: User,
    company: Company,
  ): Promise<AuthTokensResponseDto> {
    const tokens = await this.generateTokens(user, company.id);
    const companies = await this.listCompaniesForUser(user.id);

    return buildAuthTokensResponse(
      tokens.accessToken,
      tokens.refreshToken,
      user,
      company,
      companies,
    );
  }

  private async listCompaniesForUser(userId: string): Promise<Company[]> {
    const links = await this.userCompaniesRepository.findAllByUserId(userId);

    return links
      .map((link) => link.company)
      .filter((company): company is Company => Boolean(company));
  }

  private async resolveActiveCompanyForUser(userId: string): Promise<Company> {
    const companies = await this.listCompaniesForUser(userId);

    if (companies.length === 0) {
      throw new UnauthorizedException({
        message: AUTH_ERROR_MESSAGE.NO_ACTIVE_COMPANY,
        code: AUTH_ERROR_CODE.NO_ACTIVE_COMPANY,
      });
    }

    return companies[0];
  }

  private async generateTokens(
    user: User,
    companyId: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessPayload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      companyId,
      type: 'access',
    };
    const refreshPayload: AuthTokenPayload = {
      sub: user.id,
      email: user.email,
      companyId,
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

  private validateRegisterInput(
    name?: string,
    email?: string,
    password?: string,
    companyName?: string,
    companyNit?: string,
    companyPersonType?: CompanyPersonType | null,
    companyProvider?: IntegrationProvider | null,
    companyResponsible?: CompanyResponsible | null,
  ): void {
    if (!name) {
      throw new BadRequestException('El nombre es obligatorio.');
    }

    if (!email) {
      throw new BadRequestException('El email es obligatorio.');
    }

    if (!password || password.length < 6) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 6 caracteres.',
      );
    }

    if (!companyName) {
      throw new BadRequestException('El nombre de la empresa es obligatorio.');
    }

    if (!companyNit) {
      throw new BadRequestException('El NIT de la empresa es obligatorio.');
    }

    if (!companyPersonType) {
      throw new BadRequestException(
        'Debe indicar si la empresa es persona natural o persona jurídica.',
      );
    }

    if (!companyProvider) {
      throw new BadRequestException(
        'Debe seleccionar la integración SIIGO o Jarvis.',
      );
    }

    if (!companyResponsible) {
      throw new BadRequestException(
        'El nombre, teléfono y correo de la persona a cargo son obligatorios.',
      );
    }
  }

  private normalizeCompanyPersonType(
    personType?: CompanyPersonType,
  ): CompanyPersonType | null {
    return Object.values(CompanyPersonType).includes(personType!)
      ? personType!
      : null;
  }

  private normalizeIntegrationProvider(
    provider?: IntegrationProvider,
  ): IntegrationProvider | null {
    return Object.values(IntegrationProvider).includes(provider!)
      ? provider!
      : null;
  }

  private normalizeResponsible(
    responsible?: Partial<CompanyResponsible>,
  ): CompanyResponsible | null {
    const name = responsible?.name?.trim();
    const phone = responsible?.phone?.trim();
    const email = responsible?.email?.trim().toLowerCase();

    return name && phone && email ? { name, phone, email } : null;
  }

  private normalizeJarvisCredentialsSeed(
    seed?: JarvisCredentialsSeedDto,
  ): ReturnType<typeof buildJarvisCredentialsSeed> | null {
    if (!seed || typeof seed !== 'object') {
      return null;
    }

    const credentials = buildJarvisCredentialsSeed(seed);

    if (
      !credentials.business_name &&
      !credentials.address &&
      !credentials.email &&
      !credentials.phone &&
      !credentials.department &&
      !credentials.municipality &&
      !credentials.economic_activity &&
      !credentials.tax_regime &&
      !credentials.vat_regime
    ) {
      return null;
    }

    return credentials;
  }

  private normalizeNit(nit?: string): string {
    return nit?.replace(/[^\d]/g, '') ?? '';
  }
}
