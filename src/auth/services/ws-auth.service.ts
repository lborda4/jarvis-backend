import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthenticatedUserResolverService } from './authenticated-user-resolver.service';
import {
  AuthenticatedUser,
  AuthTokenPayload,
} from '../interfaces/jwt-payload.interface';
import { AppConfiguration } from '../../config/configuration';

/**
 * Equivalente de JwtStrategy para el handshake de WebSocket, que no pasa
 * por el pipeline de Passport/Guard de HTTP — verifica la firma/expiración
 * del token manualmente con JwtService y delega la misma resolución de
 * usuario/empresa que usa la autenticación HTTP.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfiguration, true>,
    private readonly authenticatedUserResolverService: AuthenticatedUserResolverService,
  ) {}

  async verify(rawToken: string): Promise<AuthenticatedUser> {
    if (!rawToken) {
      throw new UnauthorizedException('Token no proporcionado.');
    }

    let payload: AuthTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<AuthTokenPayload>(rawToken, {
        secret: this.configService.get('jwt.accessSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado.');
    }

    return this.authenticatedUserResolverService.resolve(payload);
  }
}
