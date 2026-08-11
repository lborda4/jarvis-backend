import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { AppConfiguration } from '../config/configuration';
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
    const companyNit = this.normalizeNit(request?.nit);

    this.validateRegisterInput(name, email, password, companyNit);

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

        const company = await companiesRepository.findOne({
          where: { nit: companyNit },
        });

        if (!company) {
          throw new NotFoundException({
            message: AUTH_ERROR_MESSAGE.COMPANY_NOT_REGISTERED,
            code: AUTH_ERROR_CODE.COMPANY_NOT_REGISTERED,
          });
        }

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

    const companyId = payload.companyId?.trim() ?? '';

    if (!companyId) {
      if (user.role !== UserRole.ADMIN) {
        throw new UnauthorizedException(
          'El token no contiene una empresa activa válida.',
        );
      }

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
    const companyId = currentUser.companyId?.trim() ?? '';

    if (!companyId) {
      if (user.role !== UserRole.ADMIN) {
        throw new UnauthorizedException(
          'La empresa activa no está asociada al usuario.',
        );
      }

      return buildAuthMeResponse(user, null, companies);
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

    return buildAuthMeResponse(user, userCompany.company, companies);
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
    );
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

  private validateRegisterInput(
    name?: string,
    email?: string,
    password?: string,
    companyNit?: string,
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

    if (!companyNit) {
      throw new BadRequestException('El NIT de la empresa es obligatorio.');
    }
  }

  private normalizeNit(nit?: string): string {
    return nit?.replace(/[^\d]/g, '') ?? '';
  }
}
