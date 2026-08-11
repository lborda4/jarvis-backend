import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersRepository } from '../repositories/users.repository';
import { UserCompaniesRepository } from '../repositories/user-companies.repository';
import {
  AuthenticatedUser,
  AuthTokenPayload,
} from '../interfaces/jwt-payload.interface';
import { AppConfiguration } from '../../config/configuration';
import { UserRole } from '../enums/user-role.enum';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppConfiguration, true>,
    private readonly usersRepository: UsersRepository,
    private readonly userCompaniesRepository: UserCompaniesRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  async validate(payload: AuthTokenPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Token de acceso inválido.');
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

      return {
        userId: user.id,
        email: user.email,
        companyId: null,
      };
    }

    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        payload.sub,
        companyId,
      );

    if (!userCompany?.company) {
      throw new UnauthorizedException(
        'La empresa activa del token no está asociada al usuario.',
      );
    }

    return {
      userId: user.id,
      email: user.email,
      companyId: userCompany.companyId,
    };
  }
}
