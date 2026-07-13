import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Company } from '../company/entities/company.entity';
import { ensureSiigoIntegration } from '../integration/helpers/integration-setup.helper';
import { UserCompany } from './entities/user-company.entity';
import { User } from './entities/user.entity';
import {
  AuthMeResponseDto,
  AuthTokensResponseDto,
  LoginRequestDto,
  RefreshTokenRequestDto,
  RefreshTokenResponseDto,
  RegisterRequestDto,
} from './dto/auth.dto';
import {
  buildAuthMeResponse,
  buildAuthTokensResponse,
} from './mappers/auth-response.mapper';
import { UsersRepository } from './repositories/users.repository';
import { UserCompaniesRepository } from './repositories/user-companies.repository';
import {
  getJwtAccessExpiresIn,
  getJwtRefreshExpiresIn,
  getJwtRefreshSecret,
} from './constants/auth.constants';
import { AuthTokenPayload, AuthenticatedUser } from './interfaces/jwt-payload.interface';

const BCRYPT_SALT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly usersRepository: UsersRepository,
    private readonly userCompaniesRepository: UserCompaniesRepository,
  ) {}

  async register(request: RegisterRequestDto): Promise<AuthTokensResponseDto> {
    const name = request?.name?.trim();
    const email = request?.email?.trim().toLowerCase();
    const password = request?.password ?? '';
    const companyName = request?.company?.name?.trim();
    const companyNit = this.normalizeNit(request?.company?.nit);

    this.validateRegisterInput(name, email, password, companyName, companyNit);

    const existingUser = await this.usersRepository.findByEmail(email);

    if (existingUser) {
      throw new ConflictException('Ya existe un usuario con ese email.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const { user, company } = await this.dataSource.transaction(
      async (manager) => {
        const usersRepository = manager.getRepository(User);
        const companiesRepository = manager.getRepository(Company);
        const userCompaniesRepository = manager.getRepository(UserCompany);

        const existingCompany = await companiesRepository.findOne({
          where: { nit: companyNit },
        });

        if (existingCompany) {
          throw new ConflictException(
            `Ya existe una empresa registrada con el NIT ${companyNit}.`,
          );
        }

        const createdUser = await usersRepository.save(
          usersRepository.create({
            name,
            email,
            password: passwordHash,
            active: true,
          }),
        );

        const createdCompany = await companiesRepository.save(
          companiesRepository.create({
            name: companyName,
            nit: companyNit,
          }),
        );

        await userCompaniesRepository.save(
          userCompaniesRepository.create({
            userId: createdUser.id,
            companyId: createdCompany.id,
          }),
        );

        try {
          await ensureSiigoIntegration(manager, createdCompany.id);
        } catch (error) {
          throw new BadRequestException(
            error instanceof Error
              ? error.message
              : 'No se pudo configurar la integración SIIGO.',
          );
        }

        return {
          user: createdUser,
          company: createdCompany,
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

    if (!user?.active) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const userCompany =
      await this.userCompaniesRepository.findActiveCompanyByUserId(user.id);

    if (!userCompany?.company) {
      throw new UnauthorizedException(
        'El usuario no tiene una empresa activa asociada.',
      );
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
        secret: getJwtRefreshSecret(),
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

    return buildAuthMeResponse(user, userCompany.company);
  }

  private async buildAuthResponse(
    user: User,
    company: Company,
  ): Promise<AuthTokensResponseDto> {
    const tokens = await this.generateTokens(user, company.id);

    return buildAuthTokensResponse(
      tokens.accessToken,
      tokens.refreshToken,
      user,
      company,
    );
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
        expiresIn: getJwtAccessExpiresIn() as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: getJwtRefreshSecret(),
        expiresIn: getJwtRefreshExpiresIn() as `${number}${'s' | 'm' | 'h' | 'd'}`,
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
  }

  private normalizeNit(nit?: string): string {
    return nit?.replace(/[^\d]/g, '') ?? '';
  }
}
