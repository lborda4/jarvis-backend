import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../enums/user-role.enum';

@Injectable()
export class AdvisorAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest();
    if (request.user?.role !== UserRole.ADVISOR) return true;
    const path = (request.originalUrl ?? request.url).split('?')[0].replace(/\/+$/, '');
    if (request.method === 'GET' && path === '/auth/me') return true;
    if (path === '/advisor' || path.startsWith('/advisor/')) return true;
    throw new ForbiddenException('El acceso de asesor no permite administrar empresas ni operar documentos.');
  }
}
