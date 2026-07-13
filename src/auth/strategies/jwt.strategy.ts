import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersRepository } from '../repositories/users.repository';
import { UserCompaniesRepository } from '../repositories/user-companies.repository';
import {
  getJwtAccessSecret,
} from '../constants/auth.constants';
import {
  AuthenticatedUser,
  AuthTokenPayload,
} from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly userCompaniesRepository: UserCompaniesRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtAccessSecret(),
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

    const userCompany = await this.userCompaniesRepository.findByUserIdAndCompanyId(
      payload.sub,
      payload.companyId,
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
