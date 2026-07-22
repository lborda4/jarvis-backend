import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '../../auth/enums/user-role.enum';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { UsersRepository } from '../../auth/repositories/users.repository';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly usersRepository: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const currentUser = request.user;

    if (!currentUser?.userId) {
      throw new ForbiddenException('Acceso restringido a administradores.');
    }

    const user = await this.usersRepository.findById(currentUser.userId);

    if (user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Acceso restringido a administradores.');
    }

    return true;
  }
}
