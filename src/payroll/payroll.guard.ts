import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getAuthenticatedCompanyId } from '../auth/helpers/authenticated-company.helper';
@Injectable()
export class PayrollGuard implements CanActivate {
  constructor(private readonly db: DataSource) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    const company = getAuthenticatedCompanyId(user);
    const [integration] = await this.db.query(
      "SELECT id FROM integrations WHERE company_id=$1 AND provider='JARVIS' AND active=true",
      [company],
    );
    if (!integration)
      throw new ForbiddenException(
        'La empresa no tiene una integración JARVIS activa.',
      );
    return true;
  }
}
