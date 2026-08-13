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
import { resolveActiveCompanyId } from '../helpers/authenticated-company.helper';

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

    const requestedCompanyId = payload.companyId?.trim() ?? '';

    // Sin empresa en el token (solo posible para ADMIN): un único query.
    if (!requestedCompanyId) {
      const user = await this.usersRepository.findById(payload.sub);

      if (!user?.active) {
        throw new UnauthorizedException('Usuario inactivo o no encontrado.');
      }

      resolveActiveCompanyId(
        payload.companyId,
        user.role,
        'El token no contiene una empresa activa válida.',
      );

      return {
        userId: user.id,
        email: user.email,
        companyId: null,
      };
    }

    // Con empresa: un único query trae usuario + vínculo + empresa juntos,
    // en vez de dos consultas separadas en cada request autenticado.
    const userCompany =
      await this.userCompaniesRepository.findByUserIdAndCompanyId(
        payload.sub,
        requestedCompanyId,
      );

    if (!userCompany?.user?.active) {
      throw new UnauthorizedException('Usuario inactivo o no encontrado.');
    }

    if (!userCompany.company) {
      throw new UnauthorizedException(
        'La empresa activa del token no está asociada al usuario.',
      );
    }

    return {
      userId: userCompany.user.id,
      email: userCompany.user.email,
      companyId: userCompany.companyId,
    };
  }
}
