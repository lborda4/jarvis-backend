import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/interfaces/jwt-payload.interface';
import { getAuthenticatedCompanyId } from '../../auth/helpers/authenticated-company.helper';
export class CreateSellerDto { name: string; }
@Controller('integrations/jarvis/sellers')
export class JarvisSellersController {
  constructor(private readonly source: DataSource) {}
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return { items: await this.source.query('SELECT id,name FROM jarvis_sellers WHERE company_id=$1 ORDER BY name,id', [getAuthenticatedCompanyId(user)]) };
  }
  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() request: CreateSellerDto) {
    if (typeof request?.name !== 'string' || !request.name.trim() || request.name.trim().length > 150) throw new BadRequestException('Ingresa un nombre de vendedor de hasta 150 caracteres.');
    const name = request.name.trim().replace(/\s+/g, ' ');
    const companyId = getAuthenticatedCompanyId(user);
    const [created] = await this.source.query('INSERT INTO jarvis_sellers(id,company_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id,name', [randomUUID(), companyId, name]);
    const seller = created ?? (await this.source.query('SELECT id,name FROM jarvis_sellers WHERE company_id=$1 AND lower(name)=lower($2)', [companyId, name]))[0];
    return { seller };
  }
}